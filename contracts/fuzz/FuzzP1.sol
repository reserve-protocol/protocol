// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/proxy/Clones.sol";

import "contracts/interfaces/IGnosis.sol";
import "contracts/interfaces/ITrade.sol";
import "contracts/libraries/Fixed.sol";

import "contracts/fuzz/IFuzz.sol";
import "contracts/fuzz/Trades.sol";
import "contracts/fuzz/Utils.sol";

import "contracts/p1/AssetRegistry.sol";
import "contracts/p1/BackingManager.sol";
import "contracts/p1/BasketHandler.sol";
import "contracts/p1/Broker.sol";
import "contracts/p1/Distributor.sol";
import "contracts/p1/Furnace.sol";
import "contracts/p1/Main.sol";
import "contracts/p1/RToken.sol";
import "contracts/p1/RevenueTrader.sol";
import "contracts/p1/StRSR.sol";
import "contracts/plugins/assets/RTokenAsset.sol";

// Every component must override _msgSender() in this one, common way!

contract AssetRegistryP1Fuzz is AssetRegistryP1 {
    using EnumerableSet for EnumerableSet.AddressSet;

    function _msgSender() internal view virtual override returns (address) {
        return IMainFuzz(address(main)).translateAddr(msg.sender);
    }

    function isValidToken(address tokenAddr) public view returns (bool) {
        return IERC20(tokenAddr).totalSupply() >= 0;
    }

    function isRegisteredCollateral(IERC20 token) external view returns (bool) {
        return isValidToken(address(token)) && IAsset(assets[token]).isCollateral();
    }

    function invariantsHold() external view returns (bool) {
        //     invariant: _erc20s == keys(assets)
        //    invariant: addr == assets[addr].erc20() where: addr in assets
        bool erc20sInAssetsProp = true;
        uint256 n = _erc20s.length();
        for (uint256 i = 0; i < n; ++i) {
            IERC20 erc20 = IERC20(_erc20s.at(i));
            IAsset asset = assets[erc20];
            if (address(asset.erc20()) != address(erc20)) erc20sInAssetsProp = false;
        }
        return erc20sInAssetsProp;
    }
}

contract BasketHandlerP1Fuzz is BasketHandlerP1 {
    using BasketLibP1 for Basket;
    Basket internal prev;

    function _msgSender() internal view virtual override returns (address) {
        return IMainFuzz(address(main)).translateAddr(msg.sender);
    }

    function basketLength() public view returns (uint256) {
        return basket.erc20s.length;
    }

    function savePrev() external {
        prev.setFrom(basket);
    }

    function setReweightable(bool reweight) external {
        reweightable = reweight;
    }

    function prevEqualsCurr() external view returns (bool) {
        uint256 n = basket.erc20s.length;
        if (n != prev.erc20s.length) return false;
        for (uint256 i = 0; i < n; i++) {
            if (prev.erc20s[i] != basket.erc20s[i]) return false;
            if (prev.refAmts[prev.erc20s[i]] != basket.refAmts[basket.erc20s[i]]) return false;
        }
        return true;
    }

    function invariantsHold() external view returns (bool) {
        AssetRegistryP1Fuzz reg = AssetRegistryP1Fuzz(address(main.assetRegistry()));

        // if basket.erc20s is empty then disabled == true
        bool disabledIfEmptyProp = basket.erc20s.length > 0 || disabled;

        // Basket Config
        bool validConfigBasket = true;
        uint256 n = config.erc20s.length;
        for (uint256 i = 0; i < n; i++) {
            IERC20 erc20 = config.erc20s[i];
            if (!reg.isValidToken(address(erc20))) validConfigBasket = false;
        }

        return disabledIfEmptyProp && validConfigBasket;
    }

    function isValidBasketAfterRefresh() external view returns (bool) {
        // basket is a valid Basket:
        // basket.erc20s is a valid collateral array and basket.erc20s == keys(basket.refAmts)
        AssetRegistryP1Fuzz reg = AssetRegistryP1Fuzz(address(main.assetRegistry()));
        bool validBasketProp = true;
        if (!disabled) {
            uint256 n = basket.erc20s.length;
            for (uint256 i = 0; i < n; i++) {
                IERC20 erc20 = basket.erc20s[i];
                if (!reg.isRegisteredCollateral(erc20) || basket.refAmts[erc20] == 0)
                    validBasketProp = false;
            }
        }
        return validBasketProp;
    }
}

contract BackingManagerP1Fuzz is BackingManagerP1 {
    using FixLib for uint192;

    BasketRange public basketRangePrev;

    IERC20[] public surplusTokens;
    IERC20[] public deficitTokens;

    function saveBasketRange() external {
        basketRangePrev = getCurrentBasketRange();
    }

    function saveSurplusAndDeficitTokens() external {
        Registry memory reg = IMainFuzz(address(main)).assetRegistry().getRegistry();
        uint192[] memory quantities = new uint192[](reg.erc20s.length);
        for (uint256 i = 0; i < reg.erc20s.length; ++i) {
            quantities[i] = IMainFuzz(address(main)).basketHandler().quantityUnsafe(
                reg.erc20s[i],
                reg.assets[i]
            );
        }
        uint192[] memory bals = new uint192[](reg.erc20s.length);
        for (uint256 i = 0; i < reg.erc20s.length; ++i) {
            bals[i] = reg.assets[i].bal(address(this)) + tokensOut[reg.erc20s[i]];

            // include StRSR's balance for RSR
            if (reg.erc20s[i] == IMainFuzz(address(main)).rsr())
                bals[i] += reg.assets[i].bal(address(IMainFuzz(address(main)).stRSR()));
        }

        TradingContext memory components = TradingContext({
            basketsHeld: IMainFuzz(address(main)).basketHandler().basketsHeldBy(address(this)),
            bh: IMainFuzz(address(main)).basketHandler(),
            ar: IMainFuzz(address(main)).assetRegistry(),
            stRSR: IMainFuzz(address(main)).stRSR(),
            rsr: IMainFuzz(address(main)).rsr(),
            rToken: IMainFuzz(address(main)).rToken(),
            minTradeVolume: ITrading(address(this)).minTradeVolume(),
            maxTradeSlippage: ITrading(address(this)).maxTradeSlippage(),
            quantities: quantities,
            bals: bals
        });

        IERC20[] memory erc20s = components.ar.erc20s();

        BasketRange memory range = getCurrentBasketRange();

        // Cleanup stored arrays
        delete surplusTokens;
        delete deficitTokens;

        for (uint256 i = 0; i < erc20s.length; ++i) {
            if (erc20s[i] == components.rsr) continue;

            IAsset asset = components.ar.toAsset(erc20s[i]);
            uint192 bal = asset.bal(address(this)); // {tok}
            uint192 needed = range.top.mul(
                IMainFuzz(address(main)).basketHandler().quantity(erc20s[i]),
                CEIL
            ); // {tok}
            if (bal.gt(needed)) {
                surplusTokens.push(asset.erc20());
            } else {
                // needed(Bottom): token balance needed at bottom of the basket range
                needed = range.bottom.mul(
                    IMainFuzz(address(main)).basketHandler().quantity(erc20s[i]),
                    CEIL
                ); // {tok};
                if (bal.lt(needed)) {
                    deficitTokens.push(ICollateral(address(asset)).erc20());
                }
            }
        }
    }

    function isBasketRangeSmaller() external view returns (bool) {
        BasketHandlerP1Fuzz bh = BasketHandlerP1Fuzz(
            address(IMainFuzz(address(main)).basketHandler())
        );
        BasketRange memory currentRange = getCurrentBasketRange();

        return
            currentRange.top <=
            basketRangePrev.top.mul(FIX_ONE.plus(maxTradeSlippage), CEIL) + bh.basketLength() &&
            currentRange.bottom >=
            basketRangePrev.bottom.mul(FIX_ONE.minus(maxTradeSlippage), FLOOR);
    }

    function isValidSurplusToken(IERC20 token) external view returns (bool) {
        if (address(token) == address(IMainFuzz(address(main)).rsr())) return true;

        for (uint256 i = 0; i < surplusTokens.length; i++) {
            if (address(token) == address(surplusTokens[i])) return true;
        }
        return false;
    }

    function isValidDeficitToken(IERC20 token) external view returns (bool) {
        for (uint256 i = 0; i < deficitTokens.length; i++) {
            if (address(token) == address(deficitTokens[i])) return true;
        }
        return false;
    }

    function getCurrentBasketRange() public view returns (BasketRange memory) {
        Registry memory reg = IMainFuzz(address(main)).assetRegistry().getRegistry();
        uint192[] memory quantities = new uint192[](reg.erc20s.length);
        for (uint256 i = 0; i < reg.erc20s.length; ++i) {
            quantities[i] = IMainFuzz(address(main)).basketHandler().quantityUnsafe(
                reg.erc20s[i],
                reg.assets[i]
            );
        }
        uint192[] memory bals = new uint192[](reg.erc20s.length);
        for (uint256 i = 0; i < reg.erc20s.length; ++i) {
            bals[i] = reg.assets[i].bal(address(this)) + tokensOut[reg.erc20s[i]];

            // include StRSR's balance for RSR
            if (reg.erc20s[i] == IMainFuzz(address(main)).rsr())
                bals[i] += reg.assets[i].bal(address(IMainFuzz(address(main)).stRSR()));
        }

        TradingContext memory components = TradingContext({
            basketsHeld: IMainFuzz(address(main)).basketHandler().basketsHeldBy(address(this)),
            bh: IMainFuzz(address(main)).basketHandler(),
            ar: IMainFuzz(address(main)).assetRegistry(),
            stRSR: IMainFuzz(address(main)).stRSR(),
            rsr: IMainFuzz(address(main)).rsr(),
            rToken: IMainFuzz(address(main)).rToken(),
            minTradeVolume: ITrading(address(this)).minTradeVolume(),
            maxTradeSlippage: ITrading(address(this)).maxTradeSlippage(),
            quantities: quantities,
            bals: bals
        });

        return RecollateralizationLibP1.basketRange(components, reg);
    }

    function _msgSender() internal view virtual override returns (address) {
        return IMainFuzz(address(main)).translateAddr(msg.sender);
    }

    function invariantsHold() external view returns (bool) {
        bool tradingDelayProp = tradingDelay <= MAX_TRADING_DELAY;
        bool backingBufferProp = backingBuffer <= MAX_BACKING_BUFFER;
        bool maxTradeSlippageProp = maxTradeSlippage <= MAX_TRADE_SLIPPAGE;

        return tradingDelayProp && backingBufferProp && maxTradeSlippageProp;
    }
}

contract BrokerP1Fuzz is BrokerP1 {
    using SafeERC20Upgradeable for IERC20Upgradeable;
    using EnumerableSet for EnumerableSet.AddressSet;
    using Clones for address;

    ITrade public lastOpenedTrade;
    EnumerableSet.AddressSet private tradeSet;
    mapping(address => uint256) public tradeKindSet;

    // function _openTrade(TradeRequest memory req) internal virtual returns (ITrade) {
    //     GnosisTradeMock trade = new GnosisTradeMock();
    //     IERC20Upgradeable(address(req.sell.erc20())).safeTransferFrom(
    //         _msgSender(),
    //         address(trade),
    //         req.sellAmount
    //     );

    //     trade.init(IMainFuzz(address(main)), _msgSender(), batchAuctionLength, req);
    //     tradeSet.add(address(trade));
    //     lastOpenedTrade = trade;
    //     return trade;
    // }

    function newBatchAuction(TradeRequest memory req, address caller)
        internal
        override
        returns (ITrade)
    {
        require(batchAuctionLength > 0, "batchAuctionLength unset");
        GnosisTradeMock trade = new GnosisTradeMock();
        trades[address(trade)] = true;

        // Apply Gnosis EasyAuction-specific resizing of req, if needed: Ensure that
        // max(sellAmount, minBuyAmount) <= maxTokensAllowed, while maintaining their proportion
        uint256 maxQty = (req.minBuyAmount > req.sellAmount) ? req.minBuyAmount : req.sellAmount;

        if (maxQty > GNOSIS_MAX_TOKENS) {
            req.sellAmount = mulDiv256(req.sellAmount, GNOSIS_MAX_TOKENS, maxQty, CEIL);
            req.minBuyAmount = mulDiv256(req.minBuyAmount, GNOSIS_MAX_TOKENS, maxQty, FLOOR);
        }

        // == Interactions ==
        IERC20Upgradeable(address(req.sell.erc20())).safeTransferFrom(
            caller,
            address(trade),
            req.sellAmount
        );
        trade.init(IMainFuzz(address(main)), _msgSender(), batchAuctionLength, req);
        tradeSet.add(address(trade));
        tradeKindSet[address(trade)] = uint256(TradeKind.BATCH_AUCTION);
        lastOpenedTrade = trade;
        return trade;
    }

    function newDutchAuction(
        TradeRequest memory req,
        TradePrices memory prices,
        ITrading caller
    ) internal override returns (ITrade) {
        require(
            !dutchTradeDisabled[req.sell.erc20()] && !dutchTradeDisabled[req.buy.erc20()],
            "dutch auctions disabled for token pair"
        );
        require(dutchAuctionLength > 0, "dutch auctions not enabled");
        DutchTrade trade = new DutchTradeP1Fuzz(); // cannot clone in echidna
        trades[address(trade)] = true;

        // == Interactions ==
        IERC20Upgradeable(address(req.sell.erc20())).safeTransferFrom(
            address(caller),
            address(trade),
            req.sellAmount
        );

        trade.init(caller, req.sell, req.buy, req.sellAmount, dutchAuctionLength, prices);
        tradeSet.add(address(trade));
        tradeKindSet[address(trade)] = uint256(TradeKind.DUTCH_AUCTION);
        lastOpenedTrade = trade;
        return trade;
    }

    function settleTrades() public {
        uint256 length = tradesLength();
        for (uint256 i = 0; i < length; i++) {
            GnosisTradeMock trade = GnosisTradeMock(tradeSet.at(i));
            if (trade.canSettle()) {
                ITrading(trade.origin()).settleTrade(IERC20(address(trade.sell())));
            }
        }
    }

    function tradesLength() public view returns (uint256) {
        return tradeSet.length();
    }

    function _msgSender() internal view virtual override returns (address) {
        return IMainFuzz(address(main)).translateAddr(msg.sender);
    }

    function invariantsHold() external view returns (bool) {
        // (trades[addr] == true) iff this contract has created an ITrade clone at addr
        bool tradesProp = true;
        for (uint256 i = 0; i < tradeSet.length(); i++) {
            if (!trades[tradeSet.at(i)]) tradesProp = false;
        }

        bool batchAuctionLengthProp = batchAuctionLength > 0 &&
            batchAuctionLength <= MAX_AUCTION_LENGTH;
        return tradesProp && batchAuctionLengthProp;
    }
}

contract DistributorP1Fuzz is DistributorP1 {
    using EnumerableSet for EnumerableSet.AddressSet;

    function _msgSender() internal view virtual override returns (address) {
        return IMainFuzz(address(main)).translateAddr(msg.sender);
    }

    function invariantsHold() external view returns (bool) {
        // ==== Invariants ====
        // distribution is nonzero
        RevenueTotals memory revTotals = totals();
        bool distNotEmptyProp = !(revTotals.rTokenTotal == 0 && revTotals.rsrTotal == 0);

        // No invalid distributions to FURNACE and STRSR
        bool noInvalidDistProp = distribution[FURNACE].rsrDist == 0 &&
            distribution[ST_RSR].rTokenDist == 0;

        // distribution above min value
        bool aboveMinValueProp = revTotals.rTokenTotal + revTotals.rsrTotal >= MAX_DISTRIBUTION;

        // Valid share values for destinations
        bool validShareAmtsProp = true;
        bool destinationsProp = true;
        uint256 n = destinations.length();
        for (uint256 i = 0; i < n; ++i) {
            RevenueShare storage share = distribution[destinations.at(i)];
            if (share.rTokenDist > 10000 || share.rsrDist > 10000) validShareAmtsProp = false;
            if (share.rTokenDist == 0 && share.rsrDist == 0) destinationsProp = false;
        }
        return
            distNotEmptyProp &&
            noInvalidDistProp &&
            validShareAmtsProp &&
            destinationsProp &&
            aboveMinValueProp;
    }
}

contract FurnaceP1Fuzz is FurnaceP1 {
    function _msgSender() internal view virtual override returns (address) {
        return IMainFuzz(address(main)).translateAddr(msg.sender);
    }

    function invariantsHold() external view returns (bool) {
        bool ratioProp = ratio <= MAX_RATIO;

        return ratioProp;
    }

    function assertPayouts() external view {
        // lastPayout was the timestamp of the end of the last period we paid out
        //   (or, if no periods have been paid out, the timestamp init() was called)
        // lastPayoutBal was rtoken.balanceOf(this) after the last period we paid out
        //   (or, if no periods have been paid out, that balance when init() was called)
        assert(
            lastPayout == block.timestamp || lastPayout == IMainFuzz(address(main)).deployedAt()
        );
        assert(lastPayoutBal == main.rToken().balanceOf(address(this)) || lastPayoutBal == 0);
    }
}

contract RevenueTraderP1Fuzz is RevenueTraderP1 {
    function _msgSender() internal view virtual override returns (address) {
        return IMainFuzz(address(main)).translateAddr(msg.sender);
    }

    function invariantsHold() external view returns (bool) {
        bool maxTradeSlippageProp = maxTradeSlippage <= MAX_TRADE_SLIPPAGE;
        return maxTradeSlippageProp;
    }
}

contract RTokenP1Fuzz is IRTokenFuzz, RTokenP1 {
    using FixLib for uint192;

    /// The tokens and underlying quantities needed to issue `amount` qRTokens.
    /// @dev this is distinct from basketHandler().quote() b/c the input is in RTokens, not BUs.
    /// @param amount {qRTok} quantity of qRTokens to quote.
    function quote(uint256 amount, RoundingMode roundingMode)
        external
        view
        returns (address[] memory tokens, uint256[] memory amts)
    {
        uint192 baskets = (totalSupply() > 0)
            ? basketsNeeded.muluDivu(amount, totalSupply()) // {BU * qRTok / qRTok}
            : uint192(amount); // {qRTok / qRTok}

        return main.basketHandler().quote(baskets, true, roundingMode);
    }

    function _msgSender() internal view virtual override returns (address) {
        return IMainFuzz(address(main)).translateAddr(msg.sender);
    }

    function getExchangeRate() external view returns (uint256) {
        return (FIX_ONE_256 * basketsNeeded) / totalSupply();
    }

    /*
    *  deprecated 3.0.0 - we can now go beyond MIN and MAX exchange rate with melt()
    function invariantsHold() external view returns (bool) {
        uint256 supply = totalSupply();
        if (supply == 0) return true;

        // Note: These are D18s, even though they are uint256s. This is because
        // we cannot assume we stay inside our valid range here, as that is what
        // we are checking in the first place
        uint256 low = (FIX_ONE_256 * basketsNeeded) / supply; // D18{BU/rTok}
        uint256 high = (FIX_ONE_256 * basketsNeeded + (supply - 1)) / supply; // D18{BU/rTok}

        // here we take advantage of an implicit upcast from uint192 exchange rates
        require(low >= MIN_EXCHANGE_RATE && high <= MAX_EXCHANGE_RATE, "BU rate out of range");
        return true;
    }
    *
    */
}

contract StRSRP1Fuzz is StRSRP1 {
    // A range of plausibly-valid IDs for withdraw()
    // Half-open range: i is a valid ID for withdraw() iff left <= i < right
    function idRange(address user) public view returns (uint256 left, uint256 right) {
        left = firstRemainingDraft[draftEra][user];
        right = draftQueues[draftEra][user].length;
    }

    function draftSum(address user) public view returns (uint256) {
        CumulativeDraft[] storage queue = draftQueues[draftEra][user];
        (uint256 left, uint256 right) = idRange(user);
        uint256 lowDrafts = (left == 0) ? 0 : queue[left - 1].drafts;
        uint256 hiDrafts = (right == 0) ? 0 : queue[right - 1].drafts;
        return hiDrafts - lowDrafts;
    }

    function invariantsHold() external view returns (bool) {
        bool stakesProp = totalStakes == 0 ? stakeRSR == 0 : stakeRSR > 0;
        bool draftsProp = totalDrafts == 0 ? draftRSR == 0 : draftRSR > 0;
        bool maxStakeProp = stakeRate > 0 && stakeRate <= MAX_STAKE_RATE;
        bool maxDraftProp = draftRate > 0 && draftRate <= MAX_DRAFT_RATE;
        bool totalStakesCovered = stakeRSR * stakeRate >= totalStakes * 1e18;
        bool totalDraftsCovered = draftRSR * draftRate >= totalDrafts * 1e18;

        // [total-stakes]: totalStakes == sum(bal[acct] for acct in bal)
        // [total-drafts]: totalDrafts == sum(draftSum(draft[acct]) for acct in draft)
        uint256 numTotalAddrs = IMainFuzz(address(main)).numUsers() +
            IMainFuzz(address(main)).numConstAddrs() +
            1;
        uint256 totalStakesBal;
        uint256 totalDraftsBal;
        for (uint256 i = 0; i < numTotalAddrs; i++) {
            address addr = IMainFuzz(address(main)).someAddr(i);
            totalStakesBal += balanceOf(addr);
            totalDraftsBal += draftSum(addr);
        }

        bool totalStakesBalProp = totalStakes == totalStakesBal;
        bool totalDraftsBalProp = totalDrafts == totalDraftsBal;

        return
            stakesProp &&
            draftsProp &&
            maxStakeProp &&
            maxDraftProp &&
            totalStakesCovered &&
            totalDraftsCovered &&
            totalStakesBalProp &&
            totalDraftsBalProp;
    }

    function _msgSender() internal view virtual override returns (address) {
        return IMainFuzz(address(main)).translateAddr(msg.sender);
    }
}
