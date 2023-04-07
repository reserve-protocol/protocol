// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "./MorphoAAVEFiatCollateral.sol";
import "../../../libraries/Fixed.sol";
import "./MorphoAAVEPositionWrapper.sol";


/**
 * @title MorphoAAVENonFiatCollateral
 * @notice Collateral plugin for a Morpho AAVE pool with non-fiat collateral, like WBTC
 * Expected: {tok} != {ref}, {ref} is pegged to {target} unless defaulting, {target} == {UoA}
 */
contract MorphoAAVENonFiatCollateral is MorphoAAVEFiatCollateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    AggregatorV3Interface public immutable targetUnitChainlinkFeed; // {UoA/target}
    uint48 public immutable targetUnitOracleTimeout; // {s}

    /// @param config Configuration of this collateral. config.erc20 must be a MorphoAAVEPositionWrapper
    /// @param revenue_hiding {1} A value like 1e-6 that represents the maximum refPerTok to hide
    /// @param targetUnitChainlinkFeed_ Feed units: {UoA/target}
    /// @param targetUnitOracleTimeout_ {s} oracle timeout to use for targetUnitChainlinkFeed
    constructor(
        CollateralConfig memory config,
        uint192 revenue_hiding,
        AggregatorV3Interface targetUnitChainlinkFeed_,
        uint48 targetUnitOracleTimeout_
    ) MorphoAAVEFiatCollateral(config, revenue_hiding) {
        targetUnitChainlinkFeed = targetUnitChainlinkFeed_;
        targetUnitOracleTimeout = targetUnitOracleTimeout_;
    }

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
        pegPrice = chainlinkFeed.price(oracleTimeout); // {target/ref}

        // {UoA/tok} = {UoA/target} * {target/ref} * {ref/tok}
        uint192 p = targetUnitChainlinkFeed.price(targetUnitOracleTimeout).mul(pegPrice).mul(
            _underlyingRefPerTok()
        );
        uint192 err = p.mul(oracleError, CEIL);

        low = p - err;
        high = p + err;
        // assert(low <= high); obviously true just by inspection
    }
    
}
