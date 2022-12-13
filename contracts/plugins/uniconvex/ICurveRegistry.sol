// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

interface ICurveRegistry {
    // https://github.com/curvefi/curve-pool-registry/blob/0bdb116024ccacda39295bb3949c3e6dd0a8e2d9/contracts/Registry.vy#L114
    // curve-pool-registry/contracts/Registry.vy : get_pool_from_lp_token
    function get_pool_from_lp_token(address token) external view returns (address);

    //https://curve.readthedocs.io/registry-registry.html#coins-and-coin-info
    function get_n_coins(address pool) external view returns (uint256[2] memory);

    function get_lp_token(address pool) external view returns (address);
}

