// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IDutchTradeCallee, TradeStatus, DutchTrade, ITrading } from "../trading/DutchTrade.sol";

contract DutchTradeCallbackReentrantTest is IDutchTradeCallee {
    using SafeERC20 for IERC20;

    DutchTrade private _currentTrade;
    ITrading private _trader;

    function start(DutchTrade trade, ITrading trader) external {
        _currentTrade = trade;
        _trader = trader;

        trade.buy().transferFrom(
            msg.sender,
            address(this),
            trade.bidAmount(uint48(block.timestamp))
        );

        trade.bidWithCallback(new bytes(0));
    }

    function dutchTradeCallback(
        address buyToken,
        uint256 buyAmount,
        bytes calldata
    ) external {
        require(msg.sender == address(_currentTrade), "Nope");

        IERC20(buyToken).safeTransfer(msg.sender, buyAmount);

        _trader.settleTrade(_currentTrade.sell());

        // _currentTrade.canSettle();
        // _currentTrade.settle();
    }
}
