// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "contracts/interfaces/IAsset.sol";
import "contracts/interfaces/IAssetRegistry.sol";
import "contracts/interfaces/IBroker.sol";
import "contracts/interfaces/IMain.sol";
import "contracts/p0/mixins/Trading.sol";
import "contracts/libraries/Fixed.sol";

/**
 * @title BackingManager
 * @notice The backing manager holds + manages the backing for an RToken
 */
contract BackingManagerP0 is TradingP0, IBackingManager {
    using EnumerableSet for EnumerableSet.AddressSet;
    using FixLib for Fix;
    using SafeERC20 for IERC20;

    uint256 public auctionDelay; // {s} how long to wait until starting auctions after switching
    Fix public backingBuffer; // {%} how much extra backing collateral to keep

    function init(ConstructorArgs calldata args) internal override {
        TradingP0.init(args);
        auctionDelay = args.params.auctionDelay;
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
        settleTrades();

        // Call keepers before
        main.poke();

        if (hasOpenTrades()) return;

        (, uint256 basketTimestamp) = main.basketHandler().lastSet();
        if (block.timestamp < basketTimestamp + auctionDelay) return;

        if (main.basketHandler().fullyCapitalized()) {
            handoutExcessAssets();
            return;
        }

        /* Recapitalization:
         *   1. Sell all surplus assets at Main for deficit collateral
         *   2. When there is no more surplus, seize RSR and sell that for collateral
         *   3. When there is no more RSR, pick a new basket target, and sell assets for deficits
         *   3. When all trades are dust, give RToken holders a haircut
         */

        sellSurplusAssetsForCollateral(false) ||
            sellRSRForCollateral() ||
            sellSurplusAssetsForCollateral(true) ||
            giveRTokenHoldersAHaircut();
    }

    /// Send excess assets to the RSR and RToken traders
    function handoutExcessAssets() private {
        IRToken rToken = main.rToken();

        Fix held = main.basketHandler().basketsHeldBy(address(this));
        Fix needed = rToken.basketsNeeded();

        // Mint revenue RToken
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

            Fix bal = asset.bal(address(this)); // {tok}
            Fix neededI = needed.mul(main.basketHandler().quantity(erc20s[i]));

            if (bal.gt(neededI)) {
                (uint256 rTokenShares, uint256 rsrShares) = main.distributor().totals();
                uint256 totalShares = rTokenShares + rsrShares;
                Fix delta = bal.minus(neededI).shiftLeft(int8(asset.erc20().decimals())); // {qTok}
                uint256 tokensPerShare = delta.floor() / totalShares;
                uint256 toRSR = tokensPerShare * rsrShares;
                uint256 toRToken = tokensPerShare * rTokenShares;

                if (toRSR > 0) erc20s[i].safeTransfer(address(main.rsrTrader()), toRSR);
                if (toRToken > 0) erc20s[i].safeTransfer(address(main.rTokenTrader()), toRToken);
            }
        }
    }

    /// Try to launch a surplus-asset-for-collateral auction
    /// @return Whether an auction was launched
    function sellSurplusAssetsForCollateral(bool pickTarget) private returns (bool) {
        (
            IAsset surplus,
            ICollateral deficit,
            Fix surplusAmount,
            Fix deficitAmount
        ) = largestSurplusAndDeficit(pickTarget);

        if (address(surplus) == address(0) || address(deficit) == address(0)) return false;

        // Of primary concern here is whether we can trust the prices for the assets
        // we are selling. If we cannot, then we should not `prepareTradeToCoverDeficit`

        bool trade;
        TradeRequest memory auction;
        if (
            surplus.isCollateral() &&
            main.assetRegistry().toColl(surplus.erc20()).status() == CollateralStatus.DISABLED
        ) {
            (trade, auction) = prepareTradeSell(surplus, deficit, surplusAmount);
            auction.minBuyAmount = 0;
        } else {
            (trade, auction) = prepareTradeToCoverDeficit(
                surplus,
                deficit,
                surplusAmount,
                deficitAmount
            );
        }

        if (trade) executeTrade(auction);
        return trade;
    }

    /// Try to seize RSR and sell it for missing collateral
    /// @return Whether an auction was launched
    function sellRSRForCollateral() private returns (bool) {
        assert(!hasOpenTrades() && !main.basketHandler().fullyCapitalized());

        IStRSR stRSR = main.stRSR();
        IAsset rsrAsset = main.assetRegistry().toAsset(main.rsr());

        (, ICollateral deficit, , Fix deficitAmount) = largestSurplusAndDeficit(false);
        if (address(deficit) == address(0)) return false;

        Fix availableRSR = rsrAsset.bal(address(this)).plus(rsrAsset.bal(address(stRSR)));

        (bool trade, TradeRequest memory auction) = prepareTradeToCoverDeficit(
            rsrAsset,
            deficit,
            availableRSR,
            deficitAmount
        );

        if (trade) {
            uint256 rsrBal = rsrAsset.balQ(address(this)).floor();
            if (auction.sellAmount > rsrBal) {
                stRSR.seizeRSR(auction.sellAmount - rsrBal);
            }
            executeTrade(auction);
        }
        return trade;
    }

    /// Compromise on how many baskets are needed in order to recapitalize-by-accounting
    function giveRTokenHoldersAHaircut() private returns (bool) {
        assert(!hasOpenTrades() && !main.basketHandler().fullyCapitalized());
        main.rToken().setBasketsNeeded(main.basketHandler().basketsHeldBy(address(this)));
        assert(main.basketHandler().fullyCapitalized());
        return true;
    }

    /// Compute the largest asset-token-for-collateral-token trade by identifying
    /// the most in-surplus and most in-deficit tokens relative to their basket refAmts,
    /// using the unit of account for interconversion.
    /// @param pickTarget If true, compute surplus relative to asset average;
    ///                   if false, just use basketsNeeded
    /// @return surplus Surplus asset OR address(0)
    /// @return deficit Deficit collateral OR address(0)
    /// @return sellAmount {sellTok} Surplus amount (whole tokens)
    /// @return buyAmount {buyTok} Deficit amount (whole tokens)
    function largestSurplusAndDeficit(bool pickTarget)
        private
        view
        returns (
            IAsset surplus,
            ICollateral deficit,
            Fix sellAmount,
            Fix buyAmount
        )
    {
        IAssetRegistry reg = main.assetRegistry();
        IBasketHandler basket = main.basketHandler();
        IERC20[] memory erc20s = reg.erc20s();

        // Compute basketTop and basketBottom
        // basketTop is the lowest number of BUs to which we'll try to sell surplus assets
        // basketBottom is the greatest number of BUs to which we'll try to buy deficit assets
        Fix basketTop = main.rToken().basketsNeeded(); // {BU}
        Fix basketBottom = basketTop;

        if (pickTarget) {
            Fix totalValue; // {UoA}
            for (uint256 i = 0; i < erc20s.length; i++) {
                IAsset asset = reg.toAsset(erc20s[i]);
                totalValue = totalValue.plus(asset.bal(address(this)).mul(asset.price())); // {UoA}
            }
            basketTop = totalValue.div(basket.price());

            Fix tradeVolume; // {UoA}
            for (uint256 i = 0; i < erc20s.length; i++) {
                IAsset asset = reg.toAsset(erc20s[i]);
                if (!asset.isCollateral()) continue;
                Fix needed = basketTop.mul(basket.quantity(erc20s[i]));
                Fix held = asset.bal(address(this));

                if (held.lt(needed)) {
                    Fix deficitTok = needed.minus(held);
                    tradeVolume = tradeVolume.plus(deficitTok.mul(asset.price()));
                }
            }

            basketBottom = basketTop.mul(
                FIX_ONE.minus(maxTradeSlippage.mul(tradeVolume).div(totalValue))
            ); // {BU}
        }

        // Compute supluses relative to basketTop and deficits relative to basketBottom
        Fix[] memory surpluses = new Fix[](erc20s.length); // {UoA}
        Fix[] memory deficits = new Fix[](erc20s.length); // {UoA}

        for (uint256 i = 0; i < erc20s.length; i++) {
            IAsset asset = reg.toAsset(erc20s[i]);

            // needed: {tok} that Main must hold to meet obligations
            Fix tokenTop;
            Fix tokenBottom;
            if (asset.isCollateral()) {
                tokenTop = basketTop.mul(basket.quantity(erc20s[i]));
                tokenBottom = basketBottom.mul(basket.quantity(erc20s[i]));
            }
            // held: {tok} that Main is already holding
            Fix held = asset.bal(address(this));

            if (held.gt(tokenTop)) {
                // {UoA} = {tok} * {UoA/tok}
                surpluses[i] = held.minus(tokenTop).mul(asset.price());
            } else if (held.lt(tokenBottom)) {
                // {UoA} = {tok} * {UoA/tok}
                deficits[i] = tokenBottom.minus(held).mul(asset.price());
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

        if (surplusMax.gt(FIX_ZERO)) {
            // {tok} = {UoA} / {UoA/tok}
            surplus = reg.toAsset(erc20s[surplusIndex]);
            sellAmount = surplusMax.div(surplus.price());
        }

        if (deficitMax.gt(FIX_ZERO)) {
            // {tok} = {UoA} / {UoA/tok}
            deficit = reg.toColl(erc20s[deficitIndex]);
            buyAmount = deficitMax.div(deficit.price());
        }
    }

    // === Setters ===

    function setAuctionDelay(uint256 val) external onlyOwner {
        emit AuctionDelaySet(auctionDelay, val);
        auctionDelay = val;
    }

    function setBackingBuffer(Fix val) external onlyOwner {
        emit BackingBufferSet(backingBuffer, val);
        backingBuffer = val;
    }
}
