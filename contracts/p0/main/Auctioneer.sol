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
 * @notice Handles auctions.
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
            if (!fullyCapitalized()) {
                bool launched = _tryStartNextAuction();
                if (!launched) {
                    /* If we're *here*, then we're out of capital we can trade for RToken backing,
                     * including staked RSR. There's only one option left to us... */
                    _diluteRTokenHolders();
                } else {
                    _handoutExcess();
                }
            }
        }

        // RSR Trader
        rsrTrader.poke();

        // RToken Trader
        rTokenTrader.poke();
    }

    /// Launch auctions until recapitalized
    /// Fallback to RSR seizure
    /// Fallback-fallback to RToken dilution
    /// @return Whether an auction was launched
    function _tryStartNextAuction() private returns (bool) {
        if (_toBUs(rToken().totalSupply()).lte(_actualBUHoldings())) {
            return false;
        }

        // Is there a collateral surplus?
        //     Yes: Try to trade surpluses for deficits
        //     No: Seize RSR and trade for deficit

        // Are we able to trade sideways, or is it all dust?
        (
            IAsset surplus,
            IAsset deficit,
            uint256 surplusAmount,
            uint256 deficitAmount
        ) = _largestSurplusAndDeficit();

        bool trade;
        Auction memory auction;
        if (
            surplus.isCollateral() &&
            ICollateral(address(surplus)).status() == CollateralStatus.SOUND
        ) {
            (trade, auction) = _prepareAuctionToCoverDeficit(
                surplus,
                deficit,
                surplusAmount,
                deficitAmount
            );
        } else {
            (trade, auction) = _prepareAuctionSell(surplus, deficit, surplusAmount);
            auction.minBuyAmount = 0;
        }
        if (trade) {
            _launchAuction(auction);
            return true;
        }

        // If we're here, all the surplus is dust and we're still recapitalizing
        // So it's time to seize and spend staked RSR
        (trade, auction) = _prepareAuctionToCoverDeficit(
            main.rsrAsset(),
            deficit,
            main.rsr().balanceOf(address(main.stRSR())), // max(RSR that can be seized)
            deficitAmount
        );
        if (trade) {
            uint256 balance = main.rsr().balanceOf(address(this));
            if (auction.sellAmount > balance) {
                main.stRSR().seizeRSR(auction.sellAmount - balance);
            }
            _launchAuction(auction);
            return true;
        }
        return false;
    }

    /// Compute the largest collateral-for-collateral trade by identifying
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
            IAsset deficit,
            uint256 surplusAmount,
            uint256 deficitAmount
        )
    {
        Fix targetBUs = _toBUs(rToken().totalSupply());
        // Calculate surplus and deficits relative to the target BUs.
        Fix[] memory surpluses = new Fix[](_assets.length());
        Fix[] memory deficits = new Fix[](_assets.length());
        for (uint256 i = 0; i < _assets.length(); i++) {
            IAsset a = IAsset(_assets.at(i));

            // {qTok}
            Fix bal = toFix(a.erc20().balanceOf(address(this)));
            Fix target = FIX_ZERO;
            if (a.isCollateral()) {
                // {qTok} = {BU} * {qTok/BU}
                target = targetBUs.mul(_basket.quantity(ICollateral(address(a))));
            }

            if (bal.gt(target)) {
                // {attoUSD} = ({qTok} - {qTok}) * {attoUSD/qTok}
                surpluses[i] = bal.minus(target).mul(a.price());
            } else if (bal.lt(target)) {
                // {attoUSD} = ({qTok} - {qTok}) * {attoUSD/qTok}
                deficits[i] = target.minus(bal).mul(a.price());
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
        IAsset deficitAsset = IAsset(_assets.at(deficitIndex));

        // {qSellTok} = {attoUSD} / {attoUSD/qSellTok}
        Fix sellAmount = surplusMax.div(surplusAsset.price());

        // {qBuyTok} = {attoUSD} / {attoUSD/qBuyTok}
        Fix buyAmount = deficitMax.div(deficitAsset.price());
        return (surplusAsset, deficitAsset, sellAmount.floor(), buyAmount.ceil());
    }

    /// Mint RToken and send to BackingTrader in order to recapitalize.
    function _diluteRTokenHolders() private {
        Fix target = _toBUs(rToken().totalSupply());
        Fix actual = _actualBUHoldings();
        assert(actual.lt(target));

        // {qRTok} = {BU} / {BU} * {qRTok}
        uint256 expectedSupply = target.div(actual).mulu(rToken().totalSupply()).floor();
        rToken().mint(address(this), expectedSupply - rToken().totalSupply());
    }

    /// Send excess assets to the RSR and RToken traders
    function _handoutExcess() private {
        for (uint256 i = 0; i < _assets.length(); i++) {
            IAsset a = IAsset(_assets.at(i));
            uint256 bal = a.erc20().balanceOf(address(this));
            if (bal == 0) {
                continue;
            }

            if (!a.isCollateral()) {
                uint256 amtToRSR = rsrCut().mulu(bal).round();
                a.erc20().safeTransfer(address(rsrTrader), amtToRSR); // cut
                a.erc20().safeTransfer(address(rTokenTrader), bal - amtToRSR); // 1 - cut
            } else {
                a.erc20().safeTransfer(address(rTokenTrader), bal);
            }
        }
    }
}
