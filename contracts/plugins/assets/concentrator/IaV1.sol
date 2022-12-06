// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "./IaPool.sol";

interface IaV1 is IaPool {
    /// @dev Return the total amount of assets staked.
    function totalUnderlying() external view returns (uint256);
}