// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import { FixLib, shiftl_toFix, CEIL } from "contracts/libraries/Fixed.sol";
import { AggregatorV3Interface, OracleLib } from "contracts/plugins/assets/OracleLib.sol";
import { CollateralConfig, MaplePoolFiatCollateral } from "contracts/plugins/assets/maple-v2/MaplePoolFiatCollateral.sol";
import { IMaplePool } from "contracts/plugins/assets/maple-v2/vendor/IMaplePool.sol";

/**
 * @title MaplePoolSelfReferentialCollateral
 * @notice Collateral plugin for the token given to the liquidity providers
 * The 2 target pools  are permissionless; one holds USDC, the other wETH
 * {tok} = MPL-mcWETH1
 * {ref} = wETH
 * {target} = ETH
 * {UoA} = USD
 */
contract MaplePoolSelfReferentialCollateral is MaplePoolFiatCollateral {
    using FixLib for uint192;
    using OracleLib for AggregatorV3Interface;

    // The underlying tokens may have 18 (wETH) or 6 (USDC) decimals
    // The Maple v2 tokens have the same number of decimals than their underlying

    /// @param config.chainlinkFeed Feed units: {UoA/ref}
    /// @param revenueHiding {1} A value like 1e-6 that represents the maximum refPerTok to hide
    constructor(
        CollateralConfig memory config,
        uint192 revenueHiding
    ) MaplePoolFiatCollateral(config, revenueHiding) {}

    /// Can revert, used by other contract functions in order to catch errors
    /// @return low {UoA/tok} The low price estimate
    /// @return high {UoA/tok} The high price estimate
    /// @return pegPrice {target/ref}
    function tryPrice()
        external
        view
        override
        returns (
            uint192 low,
            uint192 high,
            uint192 pegPrice
        )
    {
        // {UoA/tok} = {UoA/target} * 1 * {ref/tok}
        uint192 p = chainlinkFeed.price(oracleTimeout).mul(_underlyingRefPerTok());
        uint192 err = p.mul(oracleError, CEIL);

        low = p - err;
        high = p + err;
        // assert(low <= high); obviously true just by inspection

        pegPrice = targetPerRef(); // {ETH/wETH} = 1
    }
}
