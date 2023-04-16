// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IRToken } from "../interfaces/IRToken.sol";

struct Call {
    address to;
    bytes data;
    uint256 value;
}

struct ZapERC20Params {
    // Token to zap
    IERC20 tokenIn;
    // Total amount to zap / pull from user
    uint256 amountIn;
    // Smart contract calls to execute to produce 'amountOut' of 'tokenOut'
    Call[] commands;
    // RTokens the user requested
    uint256 amountOut;
    // RToken to issue
    IRToken tokenOut;
}
