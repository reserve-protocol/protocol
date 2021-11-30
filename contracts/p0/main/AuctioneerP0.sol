// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "contracts/p0/libraries/Auction.sol";
import "contracts/p0/interfaces/IAsset.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/interfaces/IMarket.sol";
import "contracts/p0/interfaces/IVault.sol";
import "contracts/p0/main/VaultHandlerP0.sol";
import "contracts/p0/main/Mixin.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/Pausable.sol";
import "./AssetRegistryP0.sol";
import "./MoodyP0.sol";
import "./SettingsHandlerP0.sol";
import "./VaultHandlerP0.sol";

/**
 * @title Auctioneer
 * @notice Handles auctions.
 */
contract AuctioneerP0 is Pausable, Mixin, MoodyP0, AssetRegistryP0, SettingsHandlerP0, VaultHandlerP0, IAuctioneer {
    using Auction for Auction.Info;
    using EnumerableSet for EnumerableSet.AddressSet;
    using FixLib for Fix;
    using SafeERC20 for IERC20;

    Auction.Info[] public auctions;

    IMarket private _market;

    function init(ConstructorArgs calldata args)
        public
        virtual
        override(Mixin, AssetRegistryP0, SettingsHandlerP0, VaultHandlerP0)
    {
        super.init(args);
        _market = args.market;
    }

    function poke() public virtual override notPaused {
        super.poke();
        // Closeout open auctions or sleep if they are still ongoing.
        for (uint256 i = 0; i < auctions.length; i++) {
            Auction.Info storage auction = auctions[i];
            if (auction.isOpen) {
                if (block.timestamp <= auction.endTime) {
                    return;
                }
                auction.close(furnace(), stRSR(), rewardPeriod(), _market);
                emit AuctionEnded(
                    i,
                    address(auction.sell),
                    address(auction.buy),
                    auction.clearingSellAmount,
                    auction.clearingBuyAmount,
                    auction.fate
                );
            }
        }

        // Create new BUs
        uint256 issuable = vault.maxIssuable(address(this));
        if (issuable > 0) {
            uint256[] memory amounts = vault.tokenAmounts(issuable);
            for (uint256 i = 0; i < amounts.length; i++) {
                vault.collateralAt(i).erc20().safeApprove(address(vault), amounts[i]);
            }
            vault.issue(address(this), issuable);
        }

        // Recapitalization auctions (break apart old BUs)
        if (!fullyCapitalized()) {
            _doRecapitalizationAuctions();
        } else {
            _doRevenueAuctions();
        }
    }

    /// Opens an `auction`
    function _launchAuction(Auction.Info memory auction) internal {
        auctions.push(auction);
        auctions[auctions.length - 1].open(auctionPeriod(), _market);
        emit AuctionStarted(
            auctions.length - 1,
            address(auctions[auctions.length - 1].sell),
            address(auctions[auctions.length - 1].buy),
            auctions[auctions.length - 1].sellAmount,
            auctions[auctions.length - 1].minBuyAmount,
            auctions[auctions.length - 1].fate
        );
        _setMood(Mood.TRADING);
    }

    /// Runs all auctions for recapitalization
    function _doRecapitalizationAuctions() internal {
        // Are we able to trade sideways, or is it all dust?
        (
            ICollateral sell,
            ICollateral buy,
            uint256 maxSell,
            uint256 targetBuy
        ) = _largestCollateralForCollateralTrade();

        (bool trade, Auction.Info memory auction) = _prepareAuctionBuy(
            minRecapitalizationAuctionSize(),
            sell,
            buy,
            maxSell,
            _approvedCollateral.contains(address(sell)) ? targetBuy : 0,
            Fate.Stay
        );

        if (trade) {
            _launchAuction(auction);
            return;
        }

        // Redeem BUs to open up spare collateral
        uint256 totalSupply = rToken().totalSupply();
        IVault oldVault = _oldestVault();
        if (oldVault != vault) {
            uint256 max = migrationChunk().mulu(totalSupply).toUint();
            uint256 chunk = Math.min(max, oldVault.basketUnits(address(this)));
            oldVault.redeem(address(this), chunk);
        }

        // Re-check the sideways trade
        (sell, buy, maxSell, targetBuy) = _largestCollateralForCollateralTrade();
        (trade, auction) = _prepareAuctionBuy(
            minRecapitalizationAuctionSize(),
            sell,
            buy,
            maxSell,
            _approvedCollateral.contains(address(sell)) ? targetBuy : 0,
            Fate.Stay
        );

        if (trade) {
            _launchAuction(auction);
            return;
        }

        // Fallback to seizing RSR stake
        if (rsr().balanceOf(address(stRSR())) > 0) {
            // Recapitalization: RSR -> RToken
            (trade, auction) = _prepareAuctionBuy(
                minRecapitalizationAuctionSize(),
                rsrAsset(),
                rTokenAsset(),
                rsr().balanceOf(address(stRSR())),
                totalSupply - fromBUs(vault.basketUnits(address(this))),
                Fate.Burn
            );

            if (trade) {
                stRSR().seizeRSR(auction.sellAmount - rsr().balanceOf(address(this)));
                _launchAuction(auction);
                return;
            }
        }

        // TODO: Bug - If the deficit is just small enough such that an RSR recapitalization auction is
        // not launched, then it will fall through to this case.

        // The ultimate endgame: a haircut for RToken holders.
        _accumulate();
        _historicalBasketDilution = _meltingFactor().mulu(vault.basketUnits(address(this))).divu(totalSupply);
        _setMood(Mood.CALM);
    }

    /// Runs all auctions for revenue
    function _doRevenueAuctions() internal {
        uint256 auctionLenSnapshot = auctions.length;

        // Empty oldest vault
        IVault oldVault = _oldestVault();
        if (oldVault != vault) {
            oldVault.redeem(address(this), oldVault.basketUnits(address(this)));
        }

        // RToken -> dividend RSR
        (bool launch, Auction.Info memory auction) = _prepareAuctionSell(
            minRevenueAuctionSize(),
            rTokenAsset(),
            rsrAsset(),
            rToken().balanceOf(address(this)),
            Fate.Stake
        );

        if (launch) {
            _launchAuction(auction);
        }

        if (cut().eq(FIX_ONE) || cut().eq(FIX_ZERO)) {
            // One auction only
            IAsset buyAsset = (cut().eq(FIX_ONE)) ? rsrAsset() : rTokenAsset();
            Fate fate = (cut().eq(FIX_ONE)) ? Fate.Stake : Fate.Melt;

            // COMP -> `buyAsset`
            (launch, auction) = _prepareAuctionSell(
                minRevenueAuctionSize(),
                compAsset(),
                buyAsset,
                compAsset().erc20().balanceOf(address(this)),
                fate
            );
            if (launch) {
                _launchAuction(auction);
            }

            // AAVE -> `buyAsset`
            (launch, auction) = _prepareAuctionSell(
                minRevenueAuctionSize(),
                aaveAsset(),
                buyAsset,
                aaveAsset().erc20().balanceOf(address(this)),
                fate
            );
            if (launch) {
                _launchAuction(auction);
            }
        } else {
            // Auctions in pairs, sized based on `cut:1-cut`
            bool launch2;
            Auction.Info memory auction2;

            // COMP -> dividend RSR + melting RToken
            (launch, launch2, auction, auction2) = _prepareRevenueAuctionPair(compAsset());
            if (launch && launch2) {
                _launchAuction(auction);
                _launchAuction(auction2);
            }

            // AAVE -> dividend RSR + melting RToken
            (launch, launch2, auction, auction2) = _prepareRevenueAuctionPair(aaveAsset());
            if (launch && launch2) {
                _launchAuction(auction);
                _launchAuction(auction2);
            }
        }
    }

    /// Determines what the largest collateral-for-collateral trade is.
    /// Algorithm:
    ///    1. Target a particular number of basket units based on total fiatcoins held across all collateral.
    ///    2. Choose the most in-surplus and most in-deficit collateral assets for trading.
    /// @return Sell collateral
    /// @return Buy collateral
    /// @return {sellTokLot} Sell amount
    /// @return {buyTokLot} Buy amount
    function _largestCollateralForCollateralTrade()
        private
        returns (
            ICollateral,
            ICollateral,
            uint256,
            uint256
        )
    {
        // Calculate a BU target (if we could trade with 0 slippage)
        Fix totalValue; // {attoUSD}
        for (uint256 i = 0; i < _alltimeCollateral.length(); i++) {
            ICollateral a = ICollateral(_alltimeCollateral.at(i));
            Fix bal = toFix(IERC20(a.erc20()).balanceOf(address(this)));

            // {attoUSD} = {attoUSD} + {attoUSD/qTok} * {qTok}
            totalValue = totalValue.plus(a.priceUSD(oracle()).mul(bal));
        }
        // {BU} = {attoUSD} / {attoUSD/BU}
        Fix targetBUs = totalValue.div(vault.basketRate());

        // Calculate surplus and deficits relative to the BU target.
        Fix[] memory surplus = new Fix[](_alltimeCollateral.length());
        Fix[] memory deficit = new Fix[](_alltimeCollateral.length());
        for (uint256 i = 0; i < _alltimeCollateral.length(); i++) {
            ICollateral a = ICollateral(_alltimeCollateral.at(i));
            Fix bal = toFix(IERC20(a.erc20()).balanceOf(address(this))); // {qTok}

            // {qTok} = {BU} * {qTok/BU}
            Fix target = targetBUs.mulu(vault.quantity(a));
            if (bal.gt(target)) {
                // {attoUSD} = ({qTok} - {qTok}) * {attoUSD/qTok}
                surplus[i] = bal.minus(target).mul(a.priceUSD(oracle()));
            } else if (bal.lt(target)) {
                // {attoUSD} = ({qTok} - {qTok}) * {attoUSD/qTok}
                deficit[i] = target.minus(bal).mul(a.priceUSD(oracle()));
            }
        }

        // Calculate the maximums.
        uint256 sellIndex;
        uint256 buyIndex;
        Fix surplusMax; // {attoUSD}
        Fix deficitMax; // {attoUSD}
        for (uint256 i = 0; i < _alltimeCollateral.length(); i++) {
            if (surplus[i].gt(surplusMax)) {
                surplusMax = surplus[i];
                sellIndex = i;
            }
            if (deficit[i].gt(deficitMax)) {
                deficitMax = deficit[i];
                buyIndex = i;
            }
        }

        ICollateral sell = ICollateral(_alltimeCollateral.at(sellIndex));
        ICollateral buy = ICollateral(_alltimeCollateral.at(buyIndex));

        // {qSellTok} = {attoUSD} / {attoUSD/qSellTok}
        Fix sellAmount = surplusMax.div(sell.priceUSD(oracle()));

        // {qBuyTok} = {attoUSD} / {attoUSD/qBuyTok}
        Fix buyAmount = deficitMax.div(buy.priceUSD(oracle()));
        return (sell, buy, sellAmount.toUint(), buyAmount.toUint());
    }

    /// Prepares an auction pair for revenue RSR + revenue RToken that is sized `cut:1-cut`
    /// @return launch Should launch auction 1?
    /// @return launch2 Should launch auction 2?
    /// @return auction An auction selling `asset` for RSR, sized `cut`
    /// @return auction2 An auction selling `asset` for RToken, sized `1-cut`
    function _prepareRevenueAuctionPair(IAsset asset)
        private
        returns (
            bool launch,
            bool launch2,
            Auction.Info memory auction,
            Auction.Info memory auction2
        )
    {
        // Calculate the two auctions without maintaining `cut:1-cut`
        Fix bal = toFix(asset.erc20().balanceOf(address(this)));
        Fix amountForRSR = bal.mul(cut());
        Fix amountForRToken = bal.minus(amountForRSR);

        (launch, auction) = _prepareAuctionSell(
            minRevenueAuctionSize(),
            asset,
            rsrAsset(),
            amountForRSR.toUint(),
            Fate.Stake
        );
        (launch2, auction2) = _prepareAuctionSell(
            minRevenueAuctionSize(),
            asset,
            rTokenAsset(),
            amountForRToken.toUint(),
            Fate.Melt
        );
        if (!launch || !launch2) {
            return (false, false, auction, auction2);
        }

        // Resize the smaller auction to cause the ratio to be `cut:1-cut`
        Fix expectedRatio = amountForRSR.div(amountForRToken);
        Fix actualRatio = toFix(auction.sellAmount).divu(auction2.sellAmount);
        if (actualRatio.lt(expectedRatio)) {
            Fix smallerAmountRToken = toFix(auction.sellAmount).mul(FIX_ONE.minus(cut())).div(cut());
            (launch2, auction2) = _prepareAuctionSell(
                minRevenueAuctionSize(),
                asset,
                rTokenAsset(),
                smallerAmountRToken.toUint(),
                Fate.Melt
            );
        } else if (actualRatio.gt(expectedRatio)) {
            Fix smallerAmountRSR = toFix(auction2.sellAmount).mul(cut()).div(FIX_ONE.minus(cut()));
            (launch, auction) = _prepareAuctionSell(
                minRevenueAuctionSize(),
                asset,
                rsrAsset(),
                smallerAmountRSR.toUint(),
                Fate.Stake
            );
        }
    }

    /// Prepares an auction where *sellAmount* is the independent variable and *minBuyAmount* is dependent.
    /// @param minAuctionSize {none}
    /// @param sellAmount {qSellTok}
    /// @return false if it is a dust trade
    function _prepareAuctionSell(
        Fix minAuctionSize,
        IAsset sell,
        IAsset buy,
        uint256 sellAmount,
        Fate fate
    ) private returns (bool, Auction.Info memory auction) {
        // {attoUSD} = {attoUSD/qSellTok} * {qSellTok}
        Fix rTokenMarketCapUSD = rTokenAsset().priceUSD(oracle()).mulu(rToken().totalSupply());
        Fix maxSellUSD = rTokenMarketCapUSD.mul(maxAuctionSize()); // {attoUSD}
        Fix minSellUSD = rTokenMarketCapUSD.mul(minAuctionSize); // {attoUSD}

        // {qSellTok} < {attoUSD} / {attoUSD/qSellTok}
        if (sellAmount == 0 || sellAmount < minSellUSD.div(sell.priceUSD(oracle())).toUint()) {
            return (false, auction);
        }

        sellAmount = Math.min(sellAmount, maxSellUSD.div(sell.priceUSD(oracle())).toUint()); // {qSellTok}
        Fix exactBuyAmount = toFix(sellAmount).mul(sell.priceUSD(oracle())).div(buy.priceUSD(oracle())); // {qBuyTok}
        Fix minBuyAmount = exactBuyAmount.minus(exactBuyAmount.mul(maxTradeSlippage())); // {qBuyTok}

        return (
            true,
            Auction.Info({
                sell: sell,
                buy: buy,
                sellAmount: sellAmount,
                minBuyAmount: minBuyAmount.toUint(),
                clearingSellAmount: 0,
                clearingBuyAmount: 0,
                externalAuctionId: 0,
                startTime: block.timestamp,
                endTime: block.timestamp + auctionPeriod(),
                fate: fate,
                isOpen: false
            })
        );
    }

    /// Prepares an auction where *minBuyAmount* is the independent variable and *sellAmount* is dependent.
    /// @param maxSellAmount {qSellTok}
    /// @param targetBuyAmount {qBuyTok}
    /// @return false if it is a dust trade
    function _prepareAuctionBuy(
        Fix minAuctionSize,
        IAsset sell,
        IAsset buy,
        uint256 maxSellAmount,
        uint256 targetBuyAmount,
        Fate fate
    ) private returns (bool, Auction.Info memory emptyAuction) {
        if (targetBuyAmount == 0) {
            return (
                true,
                Auction.Info({
                    sell: sell,
                    buy: buy,
                    sellAmount: maxSellAmount,
                    minBuyAmount: 0,
                    clearingSellAmount: 0,
                    clearingBuyAmount: 0,
                    externalAuctionId: 0,
                    startTime: block.timestamp,
                    endTime: block.timestamp + auctionPeriod(),
                    fate: fate,
                    isOpen: false
                })
            );
        }

        (bool trade, Auction.Info memory auction) = _prepareAuctionSell(minAuctionSize, sell, buy, maxSellAmount, fate);
        if (!trade) {
            return (false, emptyAuction);
        }

        if (auction.minBuyAmount > targetBuyAmount) {
            auction.minBuyAmount = targetBuyAmount;

            // {qSellTok} = {qBuyTok} * {attoUSD/qBuyTok} / {attoUSD/qSellTok}
            Fix exactSellAmount = toFix(auction.minBuyAmount).mul(buy.priceUSD(oracle())).div(sell.priceUSD(oracle()));

            // {qSellTok} = {qSellTok} / {none}
            auction.sellAmount = exactSellAmount.div(FIX_ONE.minus(maxTradeSlippage())).toUint();
            assert(auction.sellAmount < maxSellAmount);

            // {attoUSD} = {attoUSD/qRTok} * {qRTok}
            Fix rTokenMarketCapUSD = rTokenAsset().priceUSD(oracle()).mulu(rToken().totalSupply());
            Fix minSellUSD = rTokenMarketCapUSD.mul(minAuctionSize);

            // {qSellTok} = {attoUSD} / {attoUSD/qSellTok}
            uint256 minSellAmount = minSellUSD.div(sell.priceUSD(oracle())).toUint();
            if (auction.sellAmount < minSellAmount) {
                return (false, emptyAuction);
            }
        }

        return (true, auction);
    }
}
