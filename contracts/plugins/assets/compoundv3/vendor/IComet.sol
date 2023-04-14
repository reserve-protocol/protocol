// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

interface IComet {
    function getReserves() external view returns (int256);

    /// @dev uint104
    function targetReserves() external view returns (uint256);
}
