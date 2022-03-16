// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/p0/libraries/TradingLib.sol";
import "contracts/p0/mixins/Trading.sol";
import "contracts/interfaces/IAsset.sol";
import "contracts/interfaces/IAssetRegistry.sol";
import "contracts/interfaces/IBroker.sol";
import "contracts/interfaces/IMain.sol";
import "contracts/libraries/Fixed.sol";

enum RecapitalizationSaga {
    ASSETS_FOR_BASKETS_NEEDED,
    RSR_FOR_BASKETS_NEEDED,
    ASSETS_FOR_COMPROMISE_TARGET
}

/**
 * @title BackingManager
 * @notice The backing manager holds + manages the backing for an RToken
 */
contract BackingManagerP0 is TradingP0, IBackingManager {
    using FixLib for int192;
    using SafeERC20 for IERC20;

    // basketNonce -> RecapitalizationSaga
    mapping(uint256 => RecapitalizationSaga) public sagas;

    uint256 public tradingDelay; // {s} how long to wait until resuming trading after switching
    int192 public backingBuffer; // {%} how much extra backing collateral to keep

    function init(ConstructorArgs calldata args) internal override {
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

        (uint256 basketNonce, uint256 basketTimestamp) = main.basketHandler().lastSet();
        if (block.timestamp < basketTimestamp + tradingDelay) return;

        while (!hasOpenTrades() && !main.basketHandler().fullyCapitalized()) {
            runRecapitalizationSaga(basketNonce);
        }

        if (!hasOpenTrades() && main.basketHandler().fullyCapitalized()) {
            sagas[basketNonce] = RecapitalizationSaga.ASSETS_FOR_BASKETS_NEEDED;
            handoutExcessAssets();
        }
    }

    /// Execute one step of the recapitalization sagas for this basket
    function runRecapitalizationSaga(uint256 basketNonce) private {
        /* Recapitalization Saga:
         *   1. Sell all surplus assets at BackingManager for deficit collateral
         *   2. When there is no more surplus, seize RSR from StRSR and sell that for collateral
         *   3. When there is no more RSR, pick a new basket target, and sell assets for deficits
         *   4. When all trades are dust, give RToken holders a haircut
         */

        if (
            sagas[basketNonce] == RecapitalizationSaga.ASSETS_FOR_BASKETS_NEEDED &&
            !sellSurplusAssetsForCollateral(false)
        ) {
            sagas[basketNonce] = RecapitalizationSaga.RSR_FOR_BASKETS_NEEDED;
        } else if (
            sagas[basketNonce] == RecapitalizationSaga.RSR_FOR_BASKETS_NEEDED &&
            !sellRSRForCollateral()
        ) {
            sagas[basketNonce] = RecapitalizationSaga.ASSETS_FOR_COMPROMISE_TARGET;
        } else if (
            sagas[basketNonce] == RecapitalizationSaga.ASSETS_FOR_COMPROMISE_TARGET &&
            !sellSurplusAssetsForCollateral(true)
        ) {
            giveRTokenHoldersAHaircut();
            sagas[basketNonce] = RecapitalizationSaga.ASSETS_FOR_BASKETS_NEEDED;
        }
    }

    /// Send excess assets to the RSR and RToken traders
    function handoutExcessAssets() private {
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

    /// Try to launch a surplus-asset-for-collateral trade
    /// @return Whether this step produced a TradeRequest for the Broker
    function sellSurplusAssetsForCollateral(bool pickTarget) private returns (bool) {
        (
            IAsset surplus,
            ICollateral deficit,
            int192 surplusAmount,
            int192 deficitAmount
        ) = TradingLibP0.largestSurplusAndDeficit(main, maxTradeSlippage, pickTarget);

        if (address(surplus) == address(0) || address(deficit) == address(0)) return false;

        // Of primary concern here is whether we can trust the prices for the assets
        // we are selling. If we cannot, then we should not `prepareTradeToCoverDeficit`

        bool trade;
        TradeRequest memory req;
        if (
            surplus.isCollateral() &&
            main.assetRegistry().toColl(surplus.erc20()).status() == CollateralStatus.DISABLED
        ) {
            (trade, req) = prepareTradeSell(surplus, deficit, surplusAmount);
            req.minBuyAmount = 0;
        } else {
            (trade, req) = prepareTradeToCoverDeficit(
                surplus,
                deficit,
                surplusAmount,
                deficitAmount
            );
        }

        if (trade) tryTradeWithBroker(req);
        return trade;
    }

    /// Try to seize RSR and sell it for missing collateral
    /// @return Whether this step produced a TradeRequest for the Broker
    function sellRSRForCollateral() private returns (bool) {
        assert(!hasOpenTrades() && !main.basketHandler().fullyCapitalized());

        IStRSR stRSR = main.stRSR();
        IAsset rsrAsset = main.assetRegistry().toAsset(main.rsr());

        (, ICollateral deficit, , int192 deficitAmount) = TradingLibP0.largestSurplusAndDeficit(
            main,
            maxTradeSlippage,
            false
        );
        if (address(deficit) == address(0)) return false;

        int192 availableRSR = rsrAsset.bal(address(this)).plus(rsrAsset.bal(address(stRSR)));

        (bool trade, TradeRequest memory req) = prepareTradeToCoverDeficit(
            rsrAsset,
            deficit,
            availableRSR,
            deficitAmount
        );

        if (trade) {
            uint256 rsrBal = rsrAsset.balQ(address(this)).floor();
            if (req.sellAmount > rsrBal) {
                stRSR.seizeRSR(req.sellAmount - rsrBal);
            }
            tryTradeWithBroker(req);
        }
        return trade;
    }

    /// Compromise on how many baskets are needed in order to recapitalize-by-accounting
    function giveRTokenHoldersAHaircut() private {
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
