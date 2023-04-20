// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./mixins/TradingLib.sol";
import "./mixins/Trading.sol";
import "../libraries/DutchAuctionLib.sol";
import "../interfaces/IAsset.sol";
import "../interfaces/IAssetRegistry.sol";
import "../interfaces/IBroker.sol";
import "../interfaces/IMain.sol";
import "../libraries/Array.sol";
import "../libraries/Fixed.sol";

/**
 * @title BackingManager
 * @notice The backing manager holds + manages the backing for an RToken
 */
contract BackingManagerP0 is TradingP0, IBackingManager {
    using DutchAuctionLib for DutchAuction;
    using FixLib for uint192;
    using SafeERC20 for IERC20;

    uint48 public constant MAX_TRADING_DELAY = 31536000; // {s} 1 year
    uint192 public constant MAX_BACKING_BUFFER = 1e18; // {%}

    uint48 public tradingDelay; // {s} how long to wait until resuming trading after switching
    uint192 public backingBuffer; // {%} how much extra backing collateral to keep

    // keys: {s} dutch auction end times
    mapping(uint48 => DutchAuction) private dutchAuctions;

    function init(
        IMain main_,
        uint48 tradingDelay_,
        uint192 backingBuffer_,
        uint192 maxTradeSlippage_,
        uint192 maxTradeVolume_,
        uint48 dutchAuctionLength_
    ) public initializer {
        __Component_init(main_);
        __Trading_init(maxTradeSlippage_, maxTradeVolume_, dutchAuctionLength_);
        setTradingDelay(tradingDelay_);
        setBackingBuffer(backingBuffer_);
    }

    // Give RToken max allowance over a registered token
    /// @dev Performs a uniqueness check on the erc20s list in O(n^2)
    /// @custom:interaction
    function grantRTokenAllowance(IERC20 erc20) external notFrozen {
        require(main.assetRegistry().isRegistered(erc20), "erc20 unregistered");
        erc20.safeApprove(address(main.rToken()), 0);
        erc20.safeApprove(address(main.rToken()), type(uint256).max);
    }

    /// Maintain the overall backing policy; handout assets otherwise
    /// @custom:interaction
    function manageTokens(IERC20[] calldata erc20s) external notTradingPausedOrFrozen {
        // Token list must not contain duplicates
        require(ArrayLib.allUnique(erc20s), "duplicate tokens");

        // Call keepers before
        main.poke();

        IBasketHandler basketHandler = main.basketHandler();
        require(tradesOpen == 0, "trade open"); // a dutch auction does not count as an open trade
        require(basketHandler.isReady(), "basket not ready");
        require(
            block.timestamp >= basketHandler.timestamp() + tradingDelay + dutchAuctionLength,
            "waiting to trade"
        );
        require(!inDutchAuctionWindow(), "dutch auction ongoing");

        uint48 basketTimestamp = basketHandler.timestamp();
        require(block.timestamp >= basketTimestamp + tradingDelay, "waiting to trade");

        BasketRange memory basketsHeld = basketHandler.basketsHeldBy(address(this));

        if (basketHandler.fullyCollateralized()) {
            handoutExcessAssets(erc20s, basketsHeld.bottom);
        } else {
            /*
             * Recollateralization
             *
             * Strategy: iteratively move the system on a forgiving path towards capitalization
             * through a narrowing BU price band. The initial large spread reflects the
             * uncertainty associated with the market price of defaulted/volatile collateral, as
             * well as potential losses due to trading slippage. In the absence of further
             * collateral default, the size of the BU price band should decrease with each trade
             * until it is 0, at which point capitalization is restored.
             *
             * ======
             *
             * If we run out of capital and are still undercollateralized, we compromise
             * rToken.basketsNeeded to the current basket holdings. Haircut time.
             */

            (bool doTrade, TradeRequest memory req) = TradingLibP0.prepareRecollateralizationTrade(
                this,
                basketsHeld
            );

            if (doTrade) {
                // Seize RSR if needed
                if (req.sell.erc20() == main.rsr()) {
                    uint256 bal = req.sell.erc20().balanceOf(address(this));
                    if (req.sellAmount > bal) main.stRSR().seizeRSR(req.sellAmount - bal);
                }

                openTrade(req);
            } else {
                // Haircut time
                compromiseBasketsNeeded(basketsHeld.bottom);
            }
        }
    }

    /// Maintain the overall backing policy in an atomic swap via a dutch auction
    /// @dev Caller must have granted tokenIn allowances for required tokenIn bal
    /// @dev To get required tokenIn bal, use ethers.callstatic and look at the swap's buyAmount
    /// @param tokenIn The ERC20 token provided by the caller
    /// @param tokenOut The ERC20 token being purchased by the caller
    /// @param amountOut {qTokenOut} The exact quantity of tokenOut being purchased
    /// @return The exact Swap performed
    /// @custom:interaction RCEI
    function swap(
        IERC20 tokenIn,
        IERC20 tokenOut,
        uint256 amountOut
    ) external returns (Swap memory) {
        // == Refresh ==
        main.assetRegistry().refresh();
        // should melt() here too; TODO when we add to manageTokens()

        // === Checks + Effects ===

        require(tradesOpen == 0, "trade open"); // a dutch auction does not count as an open trade
        require(main.basketHandler().isReady(), "basket not ready");
        require(
            block.timestamp >= main.basketHandler().timestamp() + tradingDelay,
            "waiting to trade"
        );

        DutchAuction storage auction = ensureDutchAuctionIsSetup();
        // after: tradeEnd > block.timestamp

        require(auction.buy.erc20() == tokenIn, "buy token mismatch");
        require(auction.sell.erc20() == tokenOut, "sell token mismatch");

        // {buyTok}
        uint192 bidBuyAmt = shiftl_toFix(amountOut, -int8(auction.buy.erc20Decimals()));

        // === Interactions ===

        // Complete bid + swap
        return auction.bid(divuu(block.timestamp - tradeEnd, dutchAuctionLength), bidBuyAmt);
    }

    /// To be used via callstatic
    /// Should not change the dutch auction logic if accidentally called
    /// @custom:static-call
    function getSwap() external returns (Swap memory s) {
        // == Refresh ==
        main.assetRegistry().refresh();
        // should melt() here too; TODO when we add to manageTokens()

        // === Checks + Effects ===

        require(tradesOpen == 0, "trade open"); // a dutch auction does not count as an open trade
        require(main.basketHandler().isReady(), "basket not ready");
        require(
            block.timestamp >= main.basketHandler().timestamp() + tradingDelay,
            "waiting to trade"
        );

        DutchAuction storage auction = ensureDutchAuctionIsSetup();
        // after: tradeEnd > block.timestamp

        // {buyTok/sellTok}
        uint192 price = DutchAuctionLib.currentPrice(
            divuu(block.timestamp + dutchAuctionLength - tradeEnd, dutchAuctionLength),
            auction.middlePrice,
            auction.lowPrice
        );

        // {buyTok} = {sellTok} * {buyTok/sellTok}
        uint192 buyAmount = auction.sellAmount.mul(price, CEIL);

        s = Swap(
            auction.sell.erc20(),
            auction.buy.erc20(),
            auction.sellAmount.shiftl_toUint(int8(auction.sell.erc20Decimals()), FLOOR),
            buyAmount.shiftl_toUint(int8(auction.buy.erc20Decimals()), CEIL)
        );
    }

    // === Private ===

    /// Returns a dutch auction from storage or reverts
    /// Post-condition: endTrade is > block.timestamp
    function ensureDutchAuctionIsSetup() private returns (DutchAuction storage auction) {
        require(inDutchAuctionWindow(), "no dutch auction ongoing");

        auction = dutchAuctions[tradeEnd];
        if (tradeEnd > block.timestamp) {
            return auction;
        }
        // else: virtual ongoing auction; ie tradeEnd <= block.timestamp by dutchAuctionLength

        BasketRange memory basketsHeld = main.basketHandler().basketsHeldBy(address(this));

        // Same TradeRequest from manageTokens()
        (bool doTrade, TradeRequest memory req) = TradingLibP0.prepareRecollateralizationTrade(
            this,
            basketsHeld
        );

        require(doTrade, "swap not available");

        // Seize RSR if needed
        if (req.sell.erc20() == main.rsr()) {
            uint256 bal = main.rsr().balanceOf(address(this));
            if (req.sellAmount > bal) main.stRSR().seizeRSR(req.sellAmount - bal);
        }

        // {sellTok}
        uint192 sellAmount = shiftl_toFix(req.sellAmount, -int8(req.sell.erc20Decimals()));

        // at this point: the auction is virtual, make it real and advance the tradeEnd
        tradeEnd += dutchAuctionLength;
        auction = dutchAuctions[tradeEnd];
        auction.setupAuction(req.sell, req.buy, sellAmount);

        // Should be in the future by 1 dutchAuctionLength
        assert(tradeEnd > block.timestamp);
        assert(tradeEnd <= block.timestamp + dutchAuctionLength);
    }

    /// Send excess assets to the RSR and RToken traders
    /// @param wholeBasketsHeld {BU} The number of full basket units held by the BackingManager
    function handoutExcessAssets(IERC20[] calldata erc20s, uint192 wholeBasketsHeld) private {
        assert(main.basketHandler().status() == CollateralStatus.SOUND);

        // Special-case RSR to forward to StRSR pool
        uint256 rsrBal = main.rsr().balanceOf(address(this));
        if (rsrBal > 0) {
            main.rsr().safeTransfer(address(main.stRSR()), rsrBal);
        }

        // Mint revenue RToken
        uint192 needed; // {BU}
        {
            IRToken rToken = main.rToken();
            needed = rToken.basketsNeeded(); // {BU}
            if (wholeBasketsHeld.gt(needed)) {
                int8 decimals = int8(rToken.decimals());
                uint192 totalSupply = shiftl_toFix(rToken.totalSupply(), -decimals); // {rTok}

                // {BU} = {BU} - {BU}
                uint192 extraBUs = wholeBasketsHeld.minus(needed);

                // {qRTok: Fix} = {BU} * {qRTok / BU} (if needed == 0, conv rate is 1 qRTok/BU)
                uint192 rTok = (needed > 0) ? extraBUs.mulDiv(totalSupply, needed) : extraBUs;

                rToken.mint(address(this), rTok);
                rToken.setBasketsNeeded(wholeBasketsHeld);
            }
        }

        // Keep a small surplus of individual collateral
        needed = main.rToken().basketsNeeded().mul(FIX_ONE.plus(backingBuffer));

        // Handout excess assets above what is needed, including any newly minted RToken
        RevenueTotals memory totals = main.distributor().totals();
        for (uint256 i = 0; i < erc20s.length; i++) {
            IAsset asset = main.assetRegistry().toAsset(erc20s[i]);

            uint192 bal = asset.bal(address(this)); // {tok}
            uint192 req = needed.mul(main.basketHandler().quantity(erc20s[i]), CEIL);

            if (bal.gt(req)) {
                // delta: {qTok}
                uint256 delta = bal.minus(req).shiftl_toUint(int8(asset.erc20Decimals()));
                uint256 tokensPerShare = delta / (totals.rTokenTotal + totals.rsrTotal);

                {
                    uint256 toRSR = tokensPerShare * totals.rsrTotal;
                    if (toRSR > 0) erc20s[i].safeTransfer(address(main.rsrTrader()), toRSR);
                }
                {
                    uint256 toRToken = tokensPerShare * totals.rTokenTotal;
                    if (toRToken > 0) {
                        erc20s[i].safeTransfer(address(main.rTokenTrader()), toRToken);
                    }
                }
            }
        }

        // Start revenue dutch auctions
        main.rTokenTrader().processRevenue();
        main.rsrTrader().processRevenue();
    }

    /// Compromise on how many baskets are needed in order to recollateralize-by-accounting
    /// @param wholeBasketsHeld {BU} The number of full basket units held by the BackingManager
    function compromiseBasketsNeeded(uint192 wholeBasketsHeld) private {
        assert(tradesOpen == 0 && !main.basketHandler().fullyCollateralized());
        main.rToken().setBasketsNeeded(wholeBasketsHeld);
        assert(main.basketHandler().fullyCollateralized());
    }

    // === Setters ===

    /// @custom:governance
    function setTradingDelay(uint48 val) public governance {
        require(val <= MAX_TRADING_DELAY, "invalid tradingDelay");
        emit TradingDelaySet(tradingDelay, val);
        tradingDelay = val;
    }

    /// @custom:governance
    function setBackingBuffer(uint192 val) public governance {
        require(val <= MAX_BACKING_BUFFER, "invalid backingBuffer");
        emit BackingBufferSet(backingBuffer, val);
        backingBuffer = val;
    }
}
