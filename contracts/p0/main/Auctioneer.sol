// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "contracts/p0/interfaces/IAsset.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/interfaces/IMarket.sol";
import "contracts/p0/main/AssetRegistry.sol";
import "contracts/p0/main/BasketHandler.sol";
import "contracts/p0/main/RevenueDistributor.sol";
import "contracts/p0/main/Mixin.sol";
import "contracts/p0/Trader.sol";
import "contracts/p0/RevenueTrader.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/Pausable.sol";
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
    SettingsHandlerP0,
    RevenueDistributorP0,
    AssetRegistryP0,
    BasketHandlerP0,
    TraderP0,
    IAuctioneer
{
    using EnumerableSet for EnumerableSet.AddressSet;
    using FixLib for Fix;
    using SafeERC20 for IERC20Metadata;

    RevenueTraderP0 public rsrTrader;
    RevenueTraderP0 public rTokenTrader;

    function init(ConstructorArgs calldata args)
        public
        virtual
        override(Mixin, SettingsHandlerP0, RevenueDistributorP0, AssetRegistryP0, BasketHandlerP0)
    {
        super.init(args);
        initTrader(address(this));

        rsrTrader = new RevenueTraderP0(address(this), args.rsr);
        rTokenTrader = new RevenueTraderP0(address(this), args.rToken);
    }

    function manageFunds() external override notPaused {
        forceCollateralUpdates();
        closeDueAuctions();

        if (hasOpenAuctions()) return;

        if (fullyCapitalized()) {
            handoutExcessAssets();
            return;
        }

        /*
         * Recapitalization logic:
         *   1. Sell all surplus assets at Main for deficit collateral
         *   2. When there is no more surplus, seize RSR and sell that for collateral
         *   3. When there is no more RSR, give RToken holders a haircut
         */

        sellSurplusAssetsForCollateral() || sellRSRForCollateral() || giveRTokenHoldersAHaircut();
    }

    /// Send excess assets to the RSR and RToken traders
    function handoutExcessAssets() private {
        Fix held = basketsHeld();
        Fix needed = rToken().basketsNeeded();

        // Mint revenue RToken
        if (held.gt(needed)) {
            // {qRTok} = {(BU - BU) * qRTok / BU}
            uint256 qRTok = held.minus(needed).mulu(rToken().totalSupply()).div(needed).floor();
            rToken().mint(address(this), qRTok);
            rToken().setBasketsNeeded(held);
            needed = held;
        }

        // Keep a small surplus of individual collateral
        needed = needed.mul(FIX_ONE.plus(main.backingBuffer()));

        IERC20Metadata[] memory erc20s = registeredERC20s();
        // Handout excess assets above what is needed, including any newly minted RToken
        for (uint256 i = 0; i < erc20s.length; i++) {
            uint256 bal = erc20s[i].balanceOf(address(this));
            uint256 excess = bal; // {qTok}
            excess -= Math.min(excess, needed.mul(basketQuantity(erc20s[i])).ceil());

            if (excess > 0) {
                (uint256 rsrShares, uint256 totalShares) = rsrCut();
                uint256 tokensPerShare = excess / totalShares;
                uint256 toRSR = tokensPerShare * rsrShares;
                uint256 toRToken = tokensPerShare * (totalShares - rsrShares);

                if (toRSR > 0) erc20s[i].safeTransfer(address(rsrTrader), toRSR);
                if (toRToken > 0) erc20s[i].safeTransfer(address(rTokenTrader), toRToken);
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
            surplus.isCollateral() && toColl(surplus.erc20()).status() == CollateralStatus.DISABLED
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
            toAsset(rsr()),
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

    /// Compromise on how many baskets are needed in order to recapitalize-by-accounting
    function giveRTokenHoldersAHaircut() private returns (bool) {
        assert(!hasOpenAuctions() && !fullyCapitalized());
        rToken().setBasketsNeeded(basketsHeld());
        assert(fullyCapitalized());
        return true;
    }

    /// Compute the largest asset-token-for-collateral-token trade by identifying
    /// the most in-surplus and most in-deficit tokens relative to their basket refAmts,
    /// using the unit of account for interconversion.
    /// @return surplus Surplus asset
    /// @return deficit Deficit collateral
    /// @return sellAmount {sellTok} Surplus amount (whole tokens)
    /// @return buyAmount {buyTok} Deficit amount (whole tokens)
    function largestSurplusAndDeficit()
        private
        view
        returns (
            IAsset surplus,
            ICollateral deficit,
            Fix sellAmount,
            Fix buyAmount
        )
    {
        IERC20Metadata[] memory erc20s = registeredERC20s();
        Fix basketsNeeded = rToken().basketsNeeded(); // {BU}
        Fix[] memory prices = new Fix[](erc20s.length); // {UoA/tok}
        Fix[] memory surpluses = new Fix[](erc20s.length); // {UoA}
        Fix[] memory deficits = new Fix[](erc20s.length); // {UoA}

        // Calculate surplus and deficits relative to the reference basket
        for (uint256 i = 0; i < erc20s.length; i++) {
            prices[i] = toAsset(erc20s[i]).price();

            // needed: {qTok} that Main must hold to meet obligations
            uint256 needed;
            if (toAsset(erc20s[i]).isCollateral()) {
                needed = basketsNeeded.mul(basketQuantity(erc20s[i])).ceil();
            }
            // held: {qTok} that Main is already holding
            uint256 held = erc20s[i].balanceOf(address(this));

            if (held > needed) {
                // {tok} = {qTok} * {tok/qTok}
                Fix surplusTok = toFixWithShift(held - needed, -int8(erc20s[i].decimals()));
                surpluses[i] = surplusTok.mul(prices[i]);
            } else if (held < needed) {
                // {tok} = {qTok} * {tok/qTok}
                Fix deficitTok = toFixWithShift(needed - held, -int8(erc20s[i].decimals()));
                deficits[i] = deficitTok.mul(prices[i]);
            }
        }

        // Calculate the maximums.
        uint256 surplusIndex;
        uint256 deficitIndex;
        Fix surplusMax; // {UoA}
        Fix deficitMax; // {UoA}
        for (uint256 i = 0; i < erc20s.length; i++) {
            if (surpluses[i].gt(surplusMax)) {
                surplusMax = surpluses[i];
                surplusIndex = i;
            }
            if (deficits[i].gt(deficitMax)) {
                deficitMax = deficits[i];
                deficitIndex = i;
            }
        }

        // {tok} = {UoA} / {UoA/tok}
        sellAmount = surplusMax.div(prices[surplusIndex]);
        surplus = toAsset(erc20s[surplusIndex]);

        // {tok} = {UoA} / {UoA/tok}
        buyAmount = deficitMax.div(prices[deficitIndex]);
        deficit = toColl(erc20s[deficitIndex]);
    }
}
