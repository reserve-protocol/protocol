// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../libraries/Fixed.sol";
import "./IAsset.sol";
import "./IComponent.sol";
import "./ITrade.sol";
import "./IRewardable.sol";

/// A simple atomic swap
struct Swap {
    IERC20 sell;
    IERC20 buy;
    uint256 sellAmount; // {qSellTok}
    uint256 buyAmount; // {qBuyTok}
}

/**
 * @title ITrading
 * @notice Common events and refresher function for all Trading contracts
 */
interface ITrading is IComponent, IRewardableComponent {
    event MaxTradeSlippageSet(uint192 indexed oldVal, uint192 indexed newVal);
    event MinTradeVolumeSet(uint192 indexed oldVal, uint192 indexed newVal);
    event SwapPricepointSet(uint192 indexed oldVal, uint192 indexed newVal);
    event TradeCooldownSet(uint48 indexed oldVal, uint48 indexed newVal);

    // Emitted when an atomic swap is performed
    /// @param sell The ERC20 the protocol is selling
    /// @param buy The ERC20 the protocol is buying
    /// @param sellAmount {qSellTok} The quantity of the sell token
    /// @param buyAmount {qSellTok} The quantity of the buy token
    event SwapCompleted(
        IERC20 indexed sell,
        IERC20 indexed buy,
        uint256 sellAmount,
        uint256 buyAmount
    );

    /// Emitted when a trade is started
    /// @param trade The one-time-use trade contract that was just deployed
    /// @param sell The token to sell
    /// @param buy The token to buy
    /// @param sellAmount {qSellTok} The quantity of the selling token
    /// @param minBuyAmount {qBuyTok} The minimum quantity of the buying token to accept
    event TradeStarted(
        ITrade indexed trade,
        IERC20 indexed sell,
        IERC20 indexed buy,
        uint256 sellAmount,
        uint256 minBuyAmount
    );

    /// Emitted after a trade ends
    /// @param trade The one-time-use trade contract
    /// @param sell The token to sell
    /// @param buy The token to buy
    /// @param sellAmount {qSellTok} The quantity of the token sold
    /// @param buyAmount {qBuyTok} The quantity of the token bought
    event TradeSettled(
        ITrade indexed trade,
        IERC20 indexed sell,
        IERC20 indexed buy,
        uint256 sellAmount,
        uint256 buyAmount
    );

    /// Settle a single trade, expected to be used with multicall for efficient mass settlement
    /// @custom:refresher
    function settleTrade(IERC20 sell) external;

    /// @return {%} The maximum trade slippage acceptable
    function maxTradeSlippage() external view returns (uint192);

    /// @return {UoA} The minimum trade volume in UoA, applies to all assets
    function minTradeVolume() external view returns (uint192);

    /// @return {1} The swapPricepoint
    function swapPricepoint() external view returns (uint192);

    /// @return The ongoing trade for a sell token, or the zero address
    function trades(IERC20 sell) external view returns (ITrade);

    /// @return The number of ongoing trades open
    function tradesOpen() external view returns (uint48);

    /// Light wrapper around FixLib.mulDiv to support try-catch
    function mulDivCeil(
        uint192 x,
        uint192 y,
        uint192 z
    ) external pure returns (uint192);
}

interface TestITrading is ITrading {
    /// @custom:governance
    function setMaxTradeSlippage(uint192 val) external;

    /// @custom:governance
    function setMinTradeVolume(uint192 val) external;

    /// @custom:governance
    function setSwapPricepoint(uint192 val) external;

    /// @custom:governance
    function setTradeCooldown(uint192 val) external;
}
