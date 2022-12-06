// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

interface ICurveRegistry {
    function find_pool_for_coins(address _from, address _to) external view returns (address);

    function get_underlying_coins(address _pool) external view returns (address[8] memory);

    function get_coin_indices(
        address _pool,
        address _from,
        address _to
    )
        external
        view
        returns (
            int256,
            int256,
            bool
        );
}
