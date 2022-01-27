// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "contracts/p0/interfaces/IAsset.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/interfaces/IMarket.sol";
import "contracts/p0/main/BasketHandler.sol";
import "contracts/p0/main/Mixin.sol";
import "contracts/p0/Trader.sol";
import "contracts/p0/RevenueTrader.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/Pausable.sol";
import "./AssetRegistry.sol";
import "./SettingsHandler.sol";
import "./BasketHandler.sol";

/**
 * @title Auctioneer
 * @notice The auctioneer changes the asset balances located at Main using auctions to swap
 *   collateral---or in the worst-case---RSR, in order to remain capitalized. Excess assets
 *   are split according to the RSR cuts to RevenueTraders.
 */
contract AuctioneerP0 is
    Pausable,
    Mixin,
    TraderP0,
    AssetRegistryP0,
    SettingsHandlerP0,
    BasketHandlerP0,
    IAuctioneer
{
    using BasketLib for Basket;
    using EnumerableSet for EnumerableSet.AddressSet;
    using FixLib for Fix;
    using SafeERC20 for IERC20Metadata;

    RevenueTraderP0 public rsrTrader;
    RevenueTraderP0 public rTokenTrader;

    function init(ConstructorArgs calldata args)
        public
        virtual
        override(Mixin, AssetRegistryP0, SettingsHandlerP0, BasketHandlerP0)
    {
        super.init(args);
        initTrader(address(this));
        rsrTrader = new RevenueTraderP0(address(this), rsrAsset());
        rTokenTrader = new RevenueTraderP0(address(this), rTokenAsset());
    }

    function poke() public virtual override(TraderP0, Mixin, BasketHandlerP0) notPaused {
        super.poke();
        closeDueAuctions();

        if (!hasOpenAuctions()) {
            _doAuctions();
        }

        rsrTrader.poke();
        rTokenTrader.poke();
    }

    function _doAuctions() private {
        if (fullyCapitalized()) {
            _handoutExcessAssets();
            return;
        }

        /*
         * The strategy for handling undercapitalization is pretty simple:
         *   1. Prefer selling surplus collateral
         *   2. When there is no surplus collateral, seize RSR and use that
         *   3. When there is no more RSR, dilute RToken holders
         */
        if (_tryToBuyCollateral()) {
            return;
        }

        _seizeRSR();
        if (_tryToBuyCollateral()) {
            return;
        }

        _diluteRTokenHolders();
        _tryToBuyCollateral();
    }

    /// Try to launch asset-for-collateral auctions until recapitalized
    /// @return Whether an auction was launched
    function _tryToBuyCollateral() private returns (bool) {
        (
            IAsset surplus,
            ICollateral deficit,
            Fix surplusAmount,
            Fix deficitAmount
        ) = _largestSurplusAndDeficit();

        // Of primary concern here is whether we can trust the prices for the assets
        // we are selling. If we cannot, then we should not `_prepareAuctionToCoverDeficit`

        bool trade;
        Auction memory auction;
        if (
            surplus.isCollateral() &&
            ICollateral(address(surplus)).status() != CollateralStatus.SOUND
        ) {
            (trade, auction) = _prepareAuctionSell(surplus, deficit, surplusAmount);
            auction.minBuyAmount = 0;
        } else {
            (trade, auction) = _prepareAuctionToCoverDeficit(
                surplus,
                deficit,
                surplusAmount,
                deficitAmount
            );
        }
        if (trade) {
            _launchAuction(auction);
        }
        return trade;
    }

    /// Seize an amount of RSR to recapitalize our most in-deficit collateral
    function _seizeRSR() private {
        assert(!hasOpenAuctions() && !fullyCapitalized());
        (, ICollateral deficit, , Fix deficitAmount) = _largestSurplusAndDeficit();

        uint256 bal = rsr().balanceOf(address(this));
        (bool trade, Auction memory auction) = _prepareAuctionToCoverDeficit(
            rsrAsset(),
            deficit,
            toFixWithShift(bal + rsr().balanceOf(address(stRSR())), -int8(rsr().decimals())),
            deficitAmount
        );
        if (trade) {
            if (auction.sellAmount > bal) {
                stRSR().seizeRSR(auction.sellAmount - bal);
            }
        }
    }

    /// Mint RToken in order to recapitalize our most in-deficit collateral.
    function _diluteRTokenHolders() private {
        assert(!hasOpenAuctions() && !fullyCapitalized());
        (, ICollateral deficit, , Fix deficitAmount) = _largestSurplusAndDeficit();

        Fix collateralUSD;
        for (uint256 i = 0; i < _basket.size; i++) {
            ICollateral c = _basket.collateral[i];

            // {USD/tok} = {ref/tok} * {target/ref} * {USD/target}
            Fix p = c.refPerTok().mul(c.peggedTargetPerRef()).mul(c.marketPricePerTarget());

            // {tok}
            Fix tokBal = toFixWithShift(
                c.erc20().balanceOf(address(this)),
                -int8(c.erc20().decimals())
            );

            // {USD} = {USD} + {tok} * {USD/tok}
            collateralUSD = collateralUSD.plus(tokBal.mul(p));
        }

        // {USD/buyTok} = {ref/buyTok} * {target/ref} * {USD/target}
        Fix deficitPrice = deficit.refPerTok().mul(deficit.peggedTargetPerRef()).mul(
            deficit.marketPricePerTarget()
        );

        // {USD} = {USD/buyTok} * {buyTok}
        Fix deficitUSD = deficitPrice.mul(fixMax(deficitAmount, _dustThreshold(deficit)));

        // The increase in RToken supply should match the deficit to collateral USD ratios
        // TODO This calculation should probably get a second set of eyes

        Fix ratio = deficitUSD.plus(collateralUSD).div(collateralUSD);

        // {rTok} = {qRTok} / {qRTok/rTok}
        Fix rTokBal = toFixWithShift(main.rToken().totalSupply(), -int8(main.rToken().decimals()));

        // {rTok} = {none} * {rTok} - {rTok}
        Fix sellAmount = ratio.mul(rTokBal).minus(rTokBal);
        sellAmount = fixMin(sellAmount, rTokBal.mul(maxAuctionSize()));

        // Mint to self and leave
        rToken().mint(address(this), sellAmount.ceil());
    }

    /// Send excess assets to the RSR and RToken traders
    function _handoutExcessAssets() private {
        Fix target = _targetBUs();

        // First mint RToken
        Fix actual = _actualBUHoldings();
        if (actual.gt(target)) {
            uint256 toMint = _fromBUs(actual.minus(target));
            rToken().mint(address(this), toMint);
            target = _targetBUs();
        }

        // Handout excess assets, including RToken
        for (uint256 i = 0; i < _assets.length(); i++) {
            IAsset a = IAsset(_assets.at(i));
            uint256 bal = a.erc20().balanceOf(address(this));
            uint256 required = 0;
            if (a.isCollateral()) {
                ICollateral c = ICollateral(_assets.at(i));

                // {tok} = {BU} * {ref/BU} / {ref/tok}
                Fix tokRequired = target.mul(_basket.refAmts[c]).div(c.refPerTok());

                // {qTok} = {tok} * {qTok/tok}
                required = tokRequired.shiftLeft(int8(c.erc20().decimals())).ceil();
            }

            if (bal > required) {
                uint256 amtToRSR = rsrCut().mulu(bal - required).round();
                if (amtToRSR > 0) {
                    a.erc20().safeTransfer(address(rsrTrader), amtToRSR);
                }
                if (bal - required - amtToRSR > 0) {
                    a.erc20().safeTransfer(address(rTokenTrader), bal - required - amtToRSR);
                }
            }
        }
    }

    /// Compute the largest asset-for-collateral trade by identifying
    /// the most in-surplus and most in-deficit assets relative to their basket refAmts,
    /// using the unit of account for interconversion.
    /// @return Surplus (RToken/RSR/COMP/AAVE or collateral) asset
    /// @return Deficit collateral
    /// @return {sellTok} Surplus amount (whole tokens)
    /// @return {buyTok} Deficit amount (whole tokens)
    function _largestSurplusAndDeficit()
        private
        view
        returns (
            IAsset,
            ICollateral,
            Fix,
            Fix
        )
    {
        Fix targetBUs = _targetBUs(); // number of BUs needed to back the RToken fully

        // Calculate surplus and deficits relative to basket reference amounts.
        Fix[] memory prices = new Fix[](_assets.length()); // {USD/tok}
        Fix[] memory surpluses = new Fix[](_assets.length()); // {USD}
        Fix[] memory deficits = new Fix[](_assets.length()); // {USD}
        for (uint256 i = 0; i < _assets.length(); i++) {
            IAsset a = IAsset(_assets.at(i));
            Fix required = FIX_ZERO; // {USD}

            // Calculate {USD/tok} price
            if (a.isCollateral()) {
                ICollateral c = ICollateral(_assets.at(i));

                // {USD/tok} = {ref/tok} * {target/ref} * {USD/target}
                prices[i] = c.refPerTok().mul(c.peggedTargetPerRef()).mul(c.marketPricePerTarget());

                // {USD} = {BU} * {ref/BU} / {ref/tok} * {USD/tok}
                required = targetBUs.mul(_basket.refAmts[c]).div(c.refPerTok()).mul(prices[i]);
            } else {
                prices[i] = a.marketPrice();
            }

            // {tok} = {qTok} / {qTok/tok}
            Fix tokBal = toFixWithShift(
                a.erc20().balanceOf(address(this)),
                -int8(a.erc20().decimals())
            );

            // {USD} = {tok} * {USD/tok}
            Fix actual = tokBal.mul(prices[i]);
            if (actual.gt(required)) {
                surpluses[i] = actual.minus(required);
            } else if (actual.lt(required)) {
                deficits[i] = required.minus(actual);
            }
        }

        // Calculate the maximums.
        uint256 surplusIndex;
        uint256 deficitIndex;
        Fix surplusMax; // {USD}
        Fix deficitMax; // {USD}
        for (uint256 i = 0; i < _assets.length(); i++) {
            if (surpluses[i].gt(surplusMax)) {
                surplusMax = surpluses[i];
                surplusIndex = i;
            }
            if (deficits[i].gt(deficitMax)) {
                deficitMax = deficits[i];
                deficitIndex = i;
            }
        }

        IAsset surplusAsset = IAsset(_assets.at(surplusIndex));
        ICollateral deficitCollateral = ICollateral(_assets.at(deficitIndex));

        // {tok} = {USD} / {USD/tok}
        Fix sellAmount = surplusMax.div(prices[surplusIndex]);

        // {tok} = {USD} / {USD/tok}
        Fix buyAmount = deficitMax.div(prices[deficitIndex]);
        return (surplusAsset, deficitCollateral, sellAmount, buyAmount);
    }
}
