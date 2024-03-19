// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { CollateralConfig, MetaMorphoFiatCollateral } from "./MetaMorphoFiatCollateral.sol";
import { FixLib, CEIL } from "../../../libraries/Fixed.sol";
import { OracleLib } from "../OracleLib.sol";
// solhint-disable-next-line max-line-length
import { AggregatorV3Interface } from "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

/**
 * @title MetaMorphoNonFiatCollateral
 * @notice Collateral plugin for a MetaMorpho vault with non-fiat collateral that
 *         requires two oracles, like WBTC.
 *
 * Expected: {tok} != {ref}, {ref} is pegged to {target} unless defaulting, {target} != {UoA}
 */
contract MetaMorphoNonFiatCollateral is MetaMorphoFiatCollateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    AggregatorV3Interface public immutable targetUnitChainlinkFeed; // {UoA/target}
    uint48 public immutable targetUnitOracleTimeout; // {s}

    /// config.erc20 must be a MetaMorpho ERC4626 vault
    /// @param config.chainlinkFeed Feed units: {target/ref}
    /// @param revenueHiding {1} A value like 1e-6 that represents the maximum refPerTok to hide
    /// @param targetUnitChainlinkFeed_ Feed units: {UoA/target}
    /// @param targetUnitOracleTimeout_ {s} oracle timeout to use for targetUnitChainlinkFeed
    constructor(
        CollateralConfig memory config,
        uint192 revenueHiding,
        AggregatorV3Interface targetUnitChainlinkFeed_,
        uint48 targetUnitOracleTimeout_
    ) MetaMorphoFiatCollateral(config, revenueHiding) {
        targetUnitChainlinkFeed = targetUnitChainlinkFeed_;
        targetUnitOracleTimeout = targetUnitOracleTimeout_;
        maxOracleTimeout = uint48(Math.max(maxOracleTimeout, targetUnitOracleTimeout_));
    }

    /// Can revert, used by other contract functions in order to catch errors
    /// @return low {UoA/tok} The low price estimate
    /// @return high {UoA/tok} The high price estimate
    /// @return pegPrice {target/ref} The actual price observed in the peg
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
        pegPrice = chainlinkFeed.price(oracleTimeout); // {target/ref}

        // {UoA/tok} = {UoA/target} * {target/ref} * {ref/tok}
        uint192 p = targetUnitChainlinkFeed.price(targetUnitOracleTimeout).mul(pegPrice).mul(
            underlyingRefPerTok()
        );
        uint192 err = p.mul(oracleError, CEIL);

        high = p + err;
        low = p - err;
        // assert(low <= high); obviously true just by inspection
    }
}
