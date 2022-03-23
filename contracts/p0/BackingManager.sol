// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/p0/mixins/TradingLib.sol";
import "contracts/p0/mixins/Trading.sol";
import "contracts/interfaces/IAsset.sol";
import "contracts/interfaces/IAssetRegistry.sol";
import "contracts/interfaces/IBroker.sol";
import "contracts/interfaces/IMain.sol";
import "contracts/libraries/Fixed.sol";

/**
 * @title BackingManager
 * @notice The backing manager holds + manages the backing for an RToken
 */
contract BackingManagerP0 is TradingP0, IBackingManager {
    using FixLib for int192;
    using SafeERC20 for IERC20;

    uint256 public tradingDelay; // {s} how long to wait until resuming trading after switching
    int192 public backingBuffer; // {%} how much extra backing collateral to keep

    function init(ConstructorArgs memory args) internal override {
        TradingP0.init(args);
        tradingDelay = args.params.tradingDelay;
        backingBuffer = args.params.backingBuffer;
    }

    // Give RToken max allowances over all registered tokens
    function grantAllowances() external notPaused {
        require(_msgSender() == address(main.rToken()), "RToken only");
        IERC20[] memory erc20s = main.assetRegistry().erc20s();
        for (uint256 i = 0; i < erc20s.length; i++) {
            erc20s[i].approve(address(main.rToken()), type(uint256).max);
        }
    }

    /// Manage backing funds: maintain the overall backing policy
    /// Collective Action
    function manageFunds() external notPaused {
        // Call keepers before
        main.poke();

        // Do not trade when DISABLED or IFFY
        if (main.basketHandler().status() != CollateralStatus.SOUND) return;

        (, uint256 basketTimestamp) = main.basketHandler().lastSet();
        if (block.timestamp < basketTimestamp + tradingDelay) return;

        /* Recapitalization strategy:
         *   1. Liquidate surplus assets for needed deficits as long as possible
         *   2. When there are no more surplus assets, begin liquidating RSR instead
         *   3. When there is no more RSR, apply (1) to a reduced basket target
         *   4. When all trades are dust, compromise on basketsNeeded and reduce it
         */

        if (!hasOpenTrades() && !main.basketHandler().fullyCapitalized()) {
            (bool doTrade, TradeRequest memory req) = liquidateBackingTrade(false);

            if (!doTrade) {
                (doTrade, req) = liquidateInsuranceTrade();
            }

            if (!doTrade) {
                (doTrade, req) = liquidateBackingTrade(true);
            }

            if (doTrade) {
                tryOpenTrade(req);
            } else {
                compromiseBasketsNeeded();
            }
        }

        if (main.basketHandler().fullyCapitalized()) {
            handoutExcessAssets();
        }
    }

    /// Send excess assets to the RSR and RToken traders
    function handoutExcessAssets() private {
        assert(main.basketHandler().status() == CollateralStatus.SOUND);

        // Special-case RSR to forward to StRSR pool
        uint256 rsrBal = main.rsr().balanceOf(address(this));
        if (rsrBal > 0) {
            main.rsr().safeTransfer(address(main.rsrTrader()), rsrBal);
        }

        // Mint revenue RToken
        IRToken rToken = main.rToken();
        int192 held = main.basketHandler().basketsHeldBy(address(this));
        int192 needed = rToken.basketsNeeded();
        if (held.gt(needed)) {
            // {qRTok} = {(BU - BU) * qRTok / BU}
            uint256 qRTok = held.minus(needed).mulu(rToken.totalSupply()).div(needed).floor();
            rToken.mint(address(this), qRTok);
            rToken.setBasketsNeeded(held);
            needed = held;
        }

        // Keep a small surplus of individual collateral
        needed = needed.mul(FIX_ONE.plus(backingBuffer));

        IERC20[] memory erc20s = main.assetRegistry().erc20s();
        // Handout excess assets above what is needed, including any newly minted RToken
        for (uint256 i = 0; i < erc20s.length; i++) {
            IAsset asset = main.assetRegistry().toAsset(erc20s[i]);

            int192 bal = asset.bal(address(this)); // {tok}
            int192 neededI = needed.mul(main.basketHandler().quantity(erc20s[i]));

            if (bal.gt(neededI)) {
                // delta: {qTok}
                int192 delta = bal.minus(neededI).shiftLeft(int8(asset.erc20().decimals()));
                (uint256 rTokenShares, uint256 rsrShares) = main.distributor().totals();

                uint256 tokensPerShare = delta.floor() / (rTokenShares + rsrShares);
                uint256 toRSR = tokensPerShare * rsrShares;
                uint256 toRToken = tokensPerShare * rTokenShares;

                if (toRSR > 0) erc20s[i].safeTransfer(address(main.rsrTrader()), toRSR);
                if (toRToken > 0) erc20s[i].safeTransfer(address(main.rTokenTrader()), toRToken);
            }
        }
    }

    /// Prepare asset-for-collateral trade
    /// @param compromiseTarget When true, trade towards a reduced BU target
    /// @return doTrade If the trade request should be performed
    /// @return req The prepared trade request
    function liquidateBackingTrade(bool compromiseTarget)
        private
        view
        returns (bool doTrade, TradeRequest memory req)
    {
        assert(!hasOpenTrades() && !main.basketHandler().fullyCapitalized());

        (
            IAsset surplus,
            ICollateral deficit,
            int192 surplusAmount,
            int192 deficitAmount
        ) = TradingLibP0.largestSurplusAndDeficit(compromiseTarget);

        if (address(surplus) == address(0) || address(deficit) == address(0)) return (false, req);

        // Of primary concern here is whether we can trust the prices for the assets
        // we are selling. If we cannot, then we should not `prepareTradeToCoverDeficit`

        if (
            surplus.isCollateral() &&
            main.assetRegistry().toColl(surplus.erc20()).status() == CollateralStatus.DISABLED
        ) {
            (doTrade, req) = TradingLibP0.prepareTradeSell(surplus, deficit, surplusAmount);
            req.minBuyAmount = 0;
        } else {
            (doTrade, req) = TradingLibP0.prepareTradeToCoverDeficit(
                surplus,
                deficit,
                surplusAmount,
                deficitAmount
            );
        }

        return (doTrade, req);
    }

    /// Prepare a trade with seized RSR to buy for missing collateral
    /// @return doTrade If the trade request should be performed
    /// @return req The prepared trade request
    function liquidateInsuranceTrade() private returns (bool doTrade, TradeRequest memory req) {
        assert(!hasOpenTrades() && !main.basketHandler().fullyCapitalized());

        IStRSR stRSR = main.stRSR();
        IAsset rsrAsset = main.assetRegistry().toAsset(main.rsr());

        (, ICollateral deficit, , int192 deficitAmount) = TradingLibP0.largestSurplusAndDeficit(
            false
        );
        if (address(deficit) == address(0)) return (false, req);

        int192 availableRSR = rsrAsset.bal(address(this)).plus(rsrAsset.bal(address(stRSR)));

        (doTrade, req) = TradingLibP0.prepareTradeToCoverDeficit(
            rsrAsset,
            deficit,
            availableRSR,
            deficitAmount
        );

        if (doTrade) {
            uint256 rsrBal = rsrAsset.balQ(address(this)).floor();
            if (req.sellAmount > rsrBal) {
                stRSR.seizeRSR(req.sellAmount - rsrBal);
            }
        }
        return (doTrade, req);
    }

    /// Compromise on how many baskets are needed in order to recapitalize-by-accounting
    function compromiseBasketsNeeded() private {
        assert(!hasOpenTrades() && !main.basketHandler().fullyCapitalized());
        main.rToken().setBasketsNeeded(main.basketHandler().basketsHeldBy(address(this)));
        assert(main.basketHandler().fullyCapitalized());
    }

    // === Setters ===

    function setAuctionDelay(uint256 val) external onlyOwner {
        emit AuctionDelaySet(tradingDelay, val);
        tradingDelay = val;
    }

    function setBackingBuffer(int192 val) external onlyOwner {
        emit BackingBufferSet(backingBuffer, val);
        backingBuffer = val;
    }
}
