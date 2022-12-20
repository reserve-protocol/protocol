// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

error InsufficientInput(address token);
error InsufficientOutput(address token);
error InvalidRecipient();
error TargetCallFailed(address target, bytes returndata);
error TargetNotApproved(address target);

struct MarketCall {
    address target;
    uint256 value;
    IERC20 fromToken;
    uint256 amountIn;
    IERC20 toToken;
    uint256 minAmountOut;
    bytes data;
}

interface IMarket {
    function enter(MarketCall calldata call) external payable;

    function exit(MarketCall calldata call) external payable;
}
