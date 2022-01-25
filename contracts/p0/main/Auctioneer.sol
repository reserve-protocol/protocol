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
            uint256 surplusAmount,
            uint256 deficitAmount
        ) = _largestSurplusAndDeficit();

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
        (, ICollateral deficit, , uint256 deficitAmount) = _largestSurplusAndDeficit();

        uint256 bal = rsr().balanceOf(address(this));
        (bool trade, Auction memory auction) = _prepareAuctionToCoverDeficit(
            rsrAsset(),
            deficit,
            bal + rsr().balanceOf(address(stRSR())),
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
        (, ICollateral deficit, , uint256 deficitAmount) = _largestSurplusAndDeficit();
        uint256 targetBuyAmount = Math.max(deficitAmount, _dustThreshold(deficit));

        Fix collateralUSD;
        for (uint256 i = 0; i < _basket.size; i++) {
            uint256 bal = _basket.collateral[i].erc20().balanceOf(address(this));

            // {attoUSD} = {attoUSD} + {attoUSD/qTok} * {qTok}
            collateralUSD = collateralUSD.plus(_basket.collateral[i].price().mulu(bal));
        }

        // {attoUSD} = {attoUSD/qBuyTok} * {qBuyTok}
        Fix deficitUSD = deficit.price().mulu(targetBuyAmount);

        // The increase in RToken supply should match the deficit to collateral USD ratios
        Fix ratio = deficitUSD.plus(collateralUSD).div(collateralUSD);
        // TODO This calculation should probably get a second set of eyes

        // {qRTok} = {none} * {qRTok} - {qRTok}
        uint256 sellAmount = ratio.mulu(rToken().totalSupply()).ceil() - rToken().totalSupply();

        // {qRTok} = {none} * {qRTok}
        uint256 maxSellAmount = maxAuctionSize().mulu(rToken().totalSupply()).floor();

        // Mint to self and leave
        rToken().mint(address(this), Math.min(sellAmount, maxSellAmount));
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
            uint256 expected = a.isCollateral()
                ? target.mul(_basket.quantity(ICollateral(address(a)))).ceil()
                : 0;

            if (bal > expected) {
                uint256 amtToRSR = rsrCut().mulu(bal - expected).round();
                if (amtToRSR > 0) {
                    a.erc20().safeTransfer(address(rsrTrader), amtToRSR);
                }
                if (bal - expected - amtToRSR > 0 {
                    a.erc20().safeTransfer(address(rTokenTrader), bal - expected - amtToRSR);
                }
            }
        }
    }

    /// Compute the largest asset-for-collateral trade by identifying
    /// the most in-surplus and most in-deficit assets relative to the BU target.
    /// @return surplus Surplus asset
    /// @return deficit Deficit asset
    /// @return surplusAmount {qSellTok} Surplus amount
    /// @return deficitAmount {qBuyTok} Deficit amount
    function _largestSurplusAndDeficit()
        private
        view
        returns (
            IAsset surplus,
            ICollateral deficit,
            uint256 surplusAmount,
            uint256 deficitAmount
        )
    {
        Fix targetBUs = _targetBUs();
        // Calculate surplus and deficits relative to the target BUs.
        Fix[] memory surpluses = new Fix[](_assets.length());
        Fix[] memory deficits = new Fix[](_assets.length());
        for (uint256 i = 0; i < _assets.length(); i++) {
            IAsset a = IAsset(_assets.at(i));

            // {qTok}
            Fix bal = toFix(a.erc20().balanceOf(address(this)));
            Fix required = FIX_ZERO;
            if (a.isCollateral()) {
                // {qTok} = {BU} * {qTok/BU}
                required = targetBUs.mul(_basket.quantity(ICollateral(address(a))));
            }

            if (bal.gt(required)) {
                // {attoUSD} = ({qTok} - {qTok}) * {attoUSD/qTok}
                surpluses[i] = bal.minus(required).mul(a.price());
            } else if (bal.lt(required)) {
                // {attoUSD} = ({qTok} - {qTok}) * {attoUSD/qTok}
                deficits[i] = required.minus(bal).mul(a.price());
            }
        }

        // Calculate the maximums.
        uint256 surplusIndex;
        uint256 deficitIndex;
        Fix surplusMax; // {attoUSD}
        Fix deficitMax; // {attoUSD}
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

        // {qSellTok} = {attoUSD} / {attoUSD/qSellTok}
        Fix sellAmount = surplusMax.div(surplusAsset.price());

        // {qBuyTok} = {attoUSD} / {attoUSD/qBuyTok}
        Fix buyAmount = deficitMax.div(deficitCollateral.price());
        return (surplusAsset, deficitCollateral, sellAmount.floor(), buyAmount.ceil());
    }
}
