// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "./IaPool.sol";

interface IaV2 is IaPool {
    /// @dev Return the total amount of underlying assert mananged by the contract.
    function totalAssets() external view returns (uint256);
}