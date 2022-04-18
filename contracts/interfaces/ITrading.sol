// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/libraries/Fixed.sol";
import "./IAsset.sol";
import "./ITrade.sol";
import "./IRewardable.sol";

/**
 * @title ITrading
 * @notice Common events and refresher function for all Trading contracts
 */
interface ITrading is IRewardable {
    event MaxTradeSlippageSet(int192 indexed oldVal, int192 indexed newVal);
    event DustAmountSet(int192 indexed oldVal, int192 indexed newVal);

    /// Emitted when a trade is started
    /// @param index The index of the trade in the trades getter
    /// @param sell The token to sell
    /// @param buy The token to buy
    /// @param sellAmount {qSellTok} The quantity of the selling token
    /// @param minBuyAmount {qBuyTok} The minimum quantity of the buying token to accept
    event TradeStarted(
        uint256 indexed index,
        IERC20 indexed sell,
        IERC20 indexed buy,
        uint256 sellAmount,
        uint256 minBuyAmount
    );

    /// Emitted when a trade is blocked due to an inability to trade
    /// @param sell The token to sell
    /// @param buy The token to buy
    /// @param sellAmount {qSellTok} The quantity of the selling token
    /// @param minBuyAmount {qBuyTok} The minimum quantity of the buying token to accept
    event TradeBlocked(
        IERC20 indexed sell,
        IERC20 indexed buy,
        uint256 sellAmount,
        uint256 minBuyAmount
    );

    /// Emitted after a trade ends
    /// @param index The index of the trade in the trades getter
    /// @param sell The token to sell
    /// @param buy The token to buy
    /// @param sellAmount {qSellTok} The quantity of the token sold
    /// @param buyAmount {qBuyTok} The quantity of the token bought
    event TradeSettled(
        uint256 indexed index,
        IERC20 indexed sell,
        IERC20 indexed buy,
        uint256 sellAmount,
        uint256 buyAmount
    );

    /// Emitted after the settlement of a trade is blocked
    /// @param index The index of the trade in the trades getter
    event TradeSettlementBlocked(uint256 indexed index);

    /// Settle any auctions that can be settled
    /// @custom:refresher
    function settleTrades() external;

    /// @return {%} The maximum trade slippage acceptable
    function maxTradeSlippage() external view returns (int192);

    /// @return {UoA} The smallest amount of value worth trading
    function dustAmount() external view returns (int192);
}

interface TestITrading is ITrading {
    function setMaxTradeSlippage(int192 val) external;

    function setDustAmount(int192 val) external;

    function hasOpenTrades() external view returns (bool);

    function trades(uint256) external view returns (ITrade);
}
