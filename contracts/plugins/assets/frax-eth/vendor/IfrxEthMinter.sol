// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.19;

interface IfrxEthMinter {
    function submitAndDeposit(address recipient) external payable returns (uint256 shares);

    function submit() external payable;
}
