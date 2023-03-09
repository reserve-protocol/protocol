// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.17;

interface IfrxEthMinter {    
    // uint256 public constant DEPOSIT_SIZE = 32 ether;
    // uint256 public constant RATIO_PRECISION = 1e6;

    // uint256 public withholdRatio;
    // uint256 public currentWithheldETH;

    // bool public submitPaused;
    // bool public depositEtherPaused;

    function submitAndDeposit(address recipient) external payable returns (uint256 shares);
    function submit() external payable;
    function submitAndGive(address recipient) external payable;
    function depositEther(uint256 maxDeposits) external;
    function setWithholdRatio(uint256 newRatio) external;
    function moveWithheldETH(address payable to, uint256 amount) external;
    function togglePauseSubmits() external;
    function togglePauseDepositEther() external;
    function recoverEther(uint256 amount) external;
    function recoverERC20(address tokenAddress, uint256 tokenAmount) external;
}