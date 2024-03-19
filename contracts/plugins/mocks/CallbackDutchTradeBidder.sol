// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IDutchTradeCallee, DutchTrade } from "../trading/DutchTrade.sol";

contract CallbackDutchTraderBidder is IDutchTradeCallee {
    function bid(DutchTrade trade) external {
        trade.bidWithCallback(new bytes(0));
    }

    function dutchTradeCallback(
        address buyToken,
        uint256 buyAmount,
        bytes calldata
    ) external {
        IERC20(buyToken).transfer(msg.sender, buyAmount);
    }
}

contract CallbackDutchTraderBidderLowBaller is IDutchTradeCallee {
    function bid(DutchTrade trade) external {
        trade.bidWithCallback(new bytes(0));
    }

    function dutchTradeCallback(
        address buyToken,
        uint256 buyAmount,
        bytes calldata
    ) external {
        IERC20(buyToken).transfer(msg.sender, buyAmount - 1);
    }
}

contract CallbackDutchTraderBidderNoPayer is IDutchTradeCallee {
    function bid(DutchTrade trade) external {
        trade.bidWithCallback(new bytes(0));
    }

    function dutchTradeCallback(
        address buyToken,
        uint256 buyAmount,
        bytes calldata
    ) external {}
}
