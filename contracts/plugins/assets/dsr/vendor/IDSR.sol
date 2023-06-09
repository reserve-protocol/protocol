// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

interface IPot {
    function rho() external returns (uint256);

    function drip() external returns (uint256);

    /// {ray}
    function chi() external view returns (uint256);
}

interface ISavingsDai is IERC20Metadata {
    function pot() external view returns (IPot);

    function totalAssets() external view returns (uint256);
}
