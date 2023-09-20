// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

// External interface for ankrETH
interface IAnkrETH is IERC20Metadata {
    function ratio() external view returns (uint256);

    function updateRatio(uint256 newRatio) external;
}
