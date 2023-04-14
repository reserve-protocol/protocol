// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../interfaces/IAssetRegistry.sol";
import "../interfaces/IMain.sol";
import "./mixins/SwapLib.sol";
import "./mixins/Trading.sol";
import "./mixins/TradeLib.sol";

/// Trader Component that converts all asset balances at its address to a
/// single target asset and sends this asset to the Distributor.
/// @custom:oz-upgrades-unsafe-allow external-library-linking
contract RevenueTraderP1 is TradingP1, IRevenueTrader {
    using FixLib for uint192;
    using SafeERC20Upgradeable for IERC20Upgradeable;

    // Immutable after init()
    IERC20 public tokenToBuy;
    IAssetRegistry private assetRegistry;
    IDistributor private distributor;

    /// @dev minTradeVolume_ is unused by this class
    function init(
        IMain main_,
        IERC20 tokenToBuy_,
        uint192 maxTradeSlippage_,
        uint192 minTradeVolume_,
        uint192 swapPricepoint_
    ) external initializer {
        require(address(tokenToBuy_) != address(0), "invalid token address");
        __Component_init(main_);
        __Trading_init(main_, maxTradeSlippage_, minTradeVolume_, swapPricepoint_);
        assetRegistry = main_.assetRegistry();
        distributor = main_.distributor();
        tokenToBuy = tokenToBuy_;
    }

    /// If erc20 is tokenToBuy, distribute it; else, sell it for tokenToBuy
    /// @dev Intended to be used with multicall
    /// @custom:interaction CEI
    // let bal = this contract's balance of erc20
    // checks: !paused (trading), !frozen
    // does nothing if erc20 == addr(0) or bal == 0
    //
    // If erc20 is tokenToBuy:
    //   actions:
    //     erc20.increaseAllowance(distributor, bal) - two safeApprove calls to support USDT
    //     distributor.distribute(erc20, this, bal)
    //
    // If erc20 is any other registered asset (checked):
    //   actions:
    //     openTrade(prepareTradeSell(toAsset(erc20), toAsset(tokenToBuy), bal))
    //     (i.e, start a trade, selling as much of our bal of erc20 as we can, to buy tokenToBuy)
    function manageToken(IERC20 erc20) external notTradingPausedOrFrozen {
        if (address(trades[erc20]) != address(0)) return;

        uint256 bal = erc20.balanceOf(address(this));
        if (bal == 0) return;

        if (erc20 == tokenToBuy) {
            // == Interactions then return ==
            IERC20Upgradeable(address(erc20)).safeApprove(address(distributor), 0);
            IERC20Upgradeable(address(erc20)).safeApprove(address(distributor), bal);
            distributor.distribute(erc20, bal);
            return;
        }

        IAsset sell = assetRegistry.toAsset(erc20);
        IAsset buy = assetRegistry.toAsset(tokenToBuy);
        (uint192 sellPrice, ) = sell.price(); // {UoA/tok}
        (, uint192 buyPrice) = buy.price(); // {UoA/tok}

        require(buyPrice > 0 && buyPrice < FIX_MAX, "buy asset price unknown");

        TradeInfo memory trade = TradeInfo({
            sell: sell,
            buy: buy,
            sellAmount: sell.bal(address(this)),
            buyAmount: 0,
            sellPrice: sellPrice,
            buyPrice: buyPrice
        });

        // If not dust, trade the non-target asset for the target asset
        // Any asset with a broken price feed will trigger a revert here
        (bool launch, TradeRequest memory req) = TradeLib.prepareTradeSell(
            trade,
            0,
            maxTradeSlippage
        );

        if (launch) {
            openTrade(req);
        }
    }

    /// Perform a swap for the tokenToBuy
    /// @dev Caller must have granted tokenIn allowances
    /// @param tokenIn The input token, the one the caller provides
    /// @param tokenOut The output token, the one the protocol provides
    /// @param minAmountOut {qTokenOut} The minimum amount the swapper wants out
    /// @param maxAmountIn {qTokenIn} The most the swapper is willing to pay
    /// @return s The actual swap performed
    /// @custom:interaction
    function swap(
        IERC20 tokenIn,
        IERC20 tokenOut,
        uint256 maxAmountIn,
        uint256 minAmountOut
    ) external notPausedOrFrozen returns (Swap memory s) {
        // == Refresh ==
        assetRegistry.refresh();

        require(tokenIn == tokenToBuy, "wrong tokenIn");

        s = getSwap(tokenOut);

        // Require the calculated swap is better than the passed-in swap
        require(s.sell == tokenOut && s.buy == tokenIn, "swap tokens changed");
        require(s.sellAmount >= minAmountOut, "output amount fell");
        require(s.buyAmount <= maxAmountIn, "input amount increased");

        executeSwap(s);
    }

    /// @param sell The token the protocol is selling
    /// @return The next Swap, without refreshing the assetRegistry
    function getSwap(IERC20 sell) public view returns (Swap memory) {
        IAsset sellAsset = assetRegistry.toAsset(sell);
        return
            SwapLib.prepareSwap(
                TradeRequest(
                    sellAsset,
                    assetRegistry.toAsset(tokenToBuy),
                    sellAsset.bal(address(this)),
                    0 // unused, will be overwritten
                ),
                swapPricepoint,
                SwapLib.SwapVariant.CALCULATE_BUY_AMOUNT
            );
    }

    // By an accident of history, only BackingManager actually uses this param
    /// @custom:governance
    function setMinTradeVolume(uint192) public pure override {
        revert("minTradeVolume not used by RevenueTrader");
    }

    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
     */
    uint256[47] private __gap;
}
