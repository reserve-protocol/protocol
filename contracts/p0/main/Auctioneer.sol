// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "contracts/p0/interfaces/IAsset.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/interfaces/IMarket.sol";
import "contracts/p0/Component.sol";
import "contracts/p0/Trader.sol";
import "contracts/p0/RevenueTrader.sol";
import "contracts/libraries/Fixed.sol";

/**
 * @title Auctioneer
 * @notice The auctioneer changes the asset balances located at Main using auctions to swap
 *   collateral---or in the worst-case---RSR, in order to remain capitalized. Excess assets
 *   are split according to the RSR cuts to RevenueTraders.
 */
contract AuctioneerP0 is TraderP0, IAuctioneer {
    using EnumerableSet for EnumerableSet.AddressSet;
    using FixLib for Fix;
    using SafeERC20 for IERC20Metadata;

    IRevenueTrader public rsrTrader;
    IRevenueTrader public rTokenTrader;

    function init(ConstructorArgs calldata args) internal override {
        // Deploy and initialize RevenueTraders
        rsrTrader = new RevenueTraderP0(args.rsr);
        rsrTrader.initComponent(main, args);
        rTokenTrader = new RevenueTraderP0(args.rToken);
        rTokenTrader.initComponent(main, args);
    }

    function manageFunds() external override notPaused {
        main.basketHandler().forceCollateralUpdates();
        closeDueAuctions();

        if (hasOpenAuctions()) return;

        if (main.basketHandler().fullyCapitalized()) {
            handoutExcessAssets();
            return;
        }

        /* Recapitalization:
         *   1. Sell all surplus assets at Main for deficit collateral
         *   2. When there is no more surplus, seize RSR and sell that for collateral
         *   3. When there is no more RSR, give RToken holders a haircut
         */

        sellSurplusAssetsForCollateral() || sellRSRForCollateral() || giveRTokenHoldersAHaircut();
    }

    /// Send excess assets to the RSR and RToken traders
    function handoutExcessAssets() private {
        IRToken rToken = main.rToken();

        Fix held = main.basketHandler().basketsHeldBy(address(main));
        Fix needed = rToken.basketsNeeded();

        // Mint revenue RToken
        if (held.gt(needed)) {
            // {qRTok} = {(BU - BU) * qRTok / BU}
            uint256 qRTok = held.minus(needed).mulu(rToken.totalSupply()).div(needed).floor();
            rToken.mint(address(main), qRTok);
            rToken.setBasketsNeeded(held);
            needed = held;
        }

        // Keep a small surplus of individual collateral
        needed = needed.mul(FIX_ONE.plus(main.backingBuffer()));

        IERC20Metadata[] memory erc20s = main.registeredERC20s();
        // Handout excess assets above what is needed, including any newly minted RToken
        for (uint256 i = 0; i < erc20s.length; i++) {
            uint256 bal = erc20s[i].balanceOf(address(main));
            uint256 neededI = needed.mul(main.basketHandler().basketQuantity(erc20s[i])).ceil();

            if (bal > neededI) {
                (uint256 rsrShares, uint256 totalShares) = main.rsrCut();
                uint256 tokensPerShare = (bal - neededI) / totalShares;
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
            surplus.isCollateral() &&
            main.toColl(surplus.erc20()).status() == CollateralStatus.DISABLED
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
        assert(!hasOpenAuctions() && !main.basketHandler().fullyCapitalized());

        IERC20Metadata rsr = main.rsr();
        IStRSR stRSR = main.stRSR();

        (, ICollateral deficit, , Fix deficitAmount) = largestSurplusAndDeficit();

        uint256 rsrBal = rsr.balanceOf(address(main));
        (bool trade, Auction memory auction) = prepareAuctionToCoverDeficit(
            main.toAsset(rsr),
            deficit,
            toFixWithShift(rsrBal + rsr.balanceOf(address(stRSR)), -int8(rsr.decimals())),
            deficitAmount
        );

        if (trade) {
            if (auction.sellAmount > rsrBal) {
                stRSR.seizeRSR(auction.sellAmount - rsrBal);
            }
            launchAuction(auction);
        }
        return trade;
    }

    /// Compromise on how many baskets are needed in order to recapitalize-by-accounting
    function giveRTokenHoldersAHaircut() private returns (bool) {
        assert(!hasOpenAuctions() && !main.basketHandler().fullyCapitalized());
        main.rToken().setBasketsNeeded(main.basketHandler().basketsHeldBy(address(main)));
        assert(main.basketHandler().fullyCapitalized());
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
        IERC20Metadata[] memory erc20s = main.registeredERC20s();
        Fix basketsNeeded = main.rToken().basketsNeeded(); // {BU}
        Fix[] memory prices = new Fix[](erc20s.length); // {UoA/tok}
        Fix[] memory surpluses = new Fix[](erc20s.length); // {UoA}
        Fix[] memory deficits = new Fix[](erc20s.length); // {UoA}

        // Calculate surplus and deficits relative to the reference basket
        for (uint256 i = 0; i < erc20s.length; i++) {
            prices[i] = main.toAsset(erc20s[i]).price();

            // needed: {qTok} that Main must hold to meet obligations
            uint256 needed;
            if (main.toAsset(erc20s[i]).isCollateral()) {
                needed = basketsNeeded.mul(main.basketHandler().basketQuantity(erc20s[i])).ceil();
            }
            // held: {qTok} that Main is already holding
            uint256 held = erc20s[i].balanceOf(address(main));

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
        surplus = main.toAsset(erc20s[surplusIndex]);

        // {tok} = {UoA} / {UoA/tok}
        buyAmount = deficitMax.div(prices[deficitIndex]);
        deficit = main.toColl(erc20s[deficitIndex]);
    }
}
