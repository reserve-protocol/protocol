// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.17;

interface IfrxEthMinter {
    function withholdRatio() external returns (uint256);

    function currentWithheldETH() external returns (uint256);

    function submitPaused() external returns (bool);

    function depositEtherPaused() external returns (bool);

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
