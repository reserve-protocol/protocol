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
            doAuctions();
        }

        rsrTrader.poke();
        rTokenTrader.poke();
    }

    function doAuctions() private {
        if (fullyCapitalized()) {
            handoutExcessAssets();
            return;
        }

        /*
         * Recapitalization logic:
         *   1. Sell all surplus assets at Main for deficit collateral
         *   2. When there is no more surplus, seize RSR and sell that for RToken
         *   3. When there is no more RSR, give RToken holders a haircut
         */

        sellSurplusAssetsForCollateral() || sellRSRForCollateral() || giveRTokenHoldersAHaircut();
    }

    /// Send excess assets to the RSR and RToken traders
    function handoutExcessAssets() private {
        // First mint RToken
        Fix actual = actualBUHoldings();
        if (actual.gt(targetBUs)) {
            uint256 toMint = fromBUs(actual.minus(targetBUs));
            rToken().mint(address(this), toMint);
        }

        // Handout excess assets, including RToken
        for (uint256 i = 0; i < _assets.length(); i++) {
            IAsset a = IAsset(_assets.at(i));
            uint256 bal = a.erc20().balanceOf(address(this));
            uint256 required = 0;
            if (a.isCollateral()) {
                ICollateral c = ICollateral(_assets.at(i));

                // {tok} = {BU} * {ref/BU} / {ref/tok}
                Fix tokRequired = targetBUs.mul(basket.refAmts[c]).div(c.refPerTok());

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

    /// Try to launch a surplus-asset-for-collateral auction
    /// @return Whether an auction was launched
    function sellSurplusAssetsForCollateral() private returns (bool) {
        (
            IAsset surplus,
            ICollateral deficit,
            Fix surplusAmount,
            Fix deficitAmount
        ) = largestSurplusAndDeficit();

        // Of primary concern here is whether we can trust the prices for the assets
        // we are selling. If we cannot, then we should not `prepareAuctionToCoverDeficit`

        bool trade;
        Auction memory auction;
        if (
            surplus.isCollateral() &&
            ICollateral(address(surplus)).status() != CollateralStatus.SOUND
        ) {
            (trade, auction) = prepareAuctionSell(surplus, deficit, surplusAmount);
            auction.minBuyAmount = 0;
        } else {
            (trade, auction) = prepareAuctionToCoverDeficit(
                surplus,
                deficit,
                surplusAmount,
                deficitAmount
            );
        }
        if (trade) {
            launchAuction(auction);
        }
        return trade;
    }

    /// Try to seize RSR and sell it for missing collateral
    /// @return Whether an auction was launched
    function sellRSRForCollateral() private returns (bool) {
        assert(!hasOpenAuctions() && !fullyCapitalized());

        (, ICollateral deficit, , Fix deficitAmount) = largestSurplusAndDeficit();

        uint256 rsrBal = rsr().balanceOf(address(this));
        (bool trade, Auction memory auction) = prepareAuctionToCoverDeficit(
            rsrAsset(),
            deficit,
            toFixWithShift(rsrBal + rsr().balanceOf(address(stRSR())), -int8(rsr().decimals())),
            deficitAmount
        );

        if (trade) {
            if (auction.sellAmount > rsrBal) {
                stRSR().seizeRSR(auction.sellAmount - rsrBal);
            }
            launchAuction(auction);
        }
        return trade;
    }

    /// Compromise on the BU target in order to become recapitalized again
    function giveRTokenHoldersAHaircut() private returns (bool) {
        assert(!hasOpenAuctions() && !fullyCapitalized());
        targetBUs = actualBUHoldings();
        assert(fullyCapitalized());
        return true;
    }

    /// Compute the largest asset-for-collateral trade by identifying
    /// the most in-surplus and most in-deficit assets relative to their basket refAmts,
    /// using the unit of account for interconversion.
    /// @return Surplus (RToken/RSR/COMP/AAVE or collateral) asset
    /// @return Deficit collateral
    /// @return {sellTok} Surplus amount (whole tokens)
    /// @return {buyTok} Deficit amount (whole tokens)
    function largestSurplusAndDeficit()
        private
        view
        returns (
            IAsset,
            ICollateral,
            Fix,
            Fix
        )
    {
        // Calculate surplus and deficits relative to basket reference amounts.
        Fix[] memory prices = new Fix[](_assets.length()); // {UoA/tok}
        Fix[] memory surpluses = new Fix[](_assets.length()); // {UoA}
        Fix[] memory deficits = new Fix[](_assets.length()); // {UoA}
        for (uint256 i = 0; i < _assets.length(); i++) {
            IAsset a = IAsset(_assets.at(i));
            Fix required = FIX_ZERO; // {UoA}

            // Calculate {UoA/tok} price
            if (a.isCollateral()) {
                ICollateral c = ICollateral(_assets.at(i));

                // {UoA/tok} = {ref/tok} * {target/ref} * {UoA/target}
                prices[i] = c.refPerTok().mul(c.targetPerRef()).mul(c.pricePerTarget());

                // {UoA} = {BU} * {ref/BU} / {ref/tok} * {UoA/tok}
                required = targetBUs.mul(basket.refAmts[c]).div(c.refPerTok()).mul(prices[i]);
            } else {
                prices[i] = a.price();
            }

            // {tok} = {qTok} / {qTok/tok}
            Fix tokBal = toFixWithShift(
                a.erc20().balanceOf(address(this)),
                -int8(a.erc20().decimals())
            );

            // {UoA} = {tok} * {UoA/tok}
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
        Fix surplusMax; // {UoA}
        Fix deficitMax; // {UoA}
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

        // {tok} = {UoA} / {UoA/tok}
        Fix sellAmount = surplusMax.div(prices[surplusIndex]);

        // {tok} = {UoA} / {UoA/tok}
        Fix buyAmount = deficitMax.div(prices[deficitIndex]);
        return (surplusAsset, deficitCollateral, sellAmount, buyAmount);
    }
}
