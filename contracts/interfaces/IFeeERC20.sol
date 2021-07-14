// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

interface IFeeERC20 is IERC20 {
    function setFeeEnabled(bool enabled) external;
    function feeForTransfer(address from, address to, uint256 amount) external;
}
