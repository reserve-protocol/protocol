// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.28;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

// External interface for weETH
interface IWeETH is IERC20Metadata {
    function getRate() external view returns (uint256);

    function getWeETHByeETH(uint256 _eETHAmount) external view returns (uint256);

    function getEETHByWeETH(uint256 _weETHAmount) external view returns (uint256);
}
