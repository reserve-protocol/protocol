// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// External interface for ankrETH
interface IAnkrETH is IERC20 {
    function ratio() external view returns (uint256);

    function updateRatio(uint256 newRatio) external;

    function repairRatio(uint256 newRatio) external;

    function decimals() external view returns (uint8);
}
