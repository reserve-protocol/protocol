// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

interface ICurveRegistry {
    function find_pool_for_coins(address _from, address _to) external view returns (address);
}
