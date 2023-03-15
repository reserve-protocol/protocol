// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "../../libraries/Fixed.sol";
import "./FiatCollateral.sol";

/**
 * @title NonFiatCollateral
 * @notice Collateral plugin for a nonfiat collateral that requires default checks, such as WBTC.
 * Expected: {tok} == {ref}, {ref} is pegged to {target} or defaulting, {target} != {UoA}
 */
contract NonFiatCollateral is FiatCollateral {
    using FixLib for uint192;
    using OracleLib for AggregatorV3Interface;

    AggregatorV3Interface public immutable targetUnitChainlinkFeed; // {UoA/target}
    uint48 public immutable targetUnitOracleTimeout; // {s}

    /// @param config.chainlinkFeed Feed units: {target/ref}
    /// @param targetUnitChainlinkFeed_ Feed units: {UoA/target}
    /// @param targetUnitOracleTimeout_ {s} oracle timeout to use for targetUnitChainlinkFeed
    constructor(
        CollateralConfig memory config,
        AggregatorV3Interface targetUnitChainlinkFeed_,
        uint48 targetUnitOracleTimeout_
    ) FiatCollateral(config) {
        require(address(targetUnitChainlinkFeed_) != address(0), "missing targetUnit feed");
        require(targetUnitOracleTimeout_ > 0, "targetUnitOracleTimeout zero");
        targetUnitChainlinkFeed = targetUnitChainlinkFeed_;
        targetUnitOracleTimeout = targetUnitOracleTimeout_;
    }

    /// Can revert, used by other contract functions in order to catch errors
    /// @param low {UoA/tok} The low price estimate
    /// @param high {UoA/tok} The high price estimate
    /// @param pegPrice {target/ref}
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

        // {UoA/target}
        uint192 pricePerTarget = targetUnitChainlinkFeed.price(targetUnitOracleTimeout);

        // Assumption: {ref/tok} = 1; inherit from `AppreciatingFiatCollateral` if need appreciation
        // {UoA/tok} = {UoA/target} * {ref/tok} * {target/ref} (1)
        uint192 p = pricePerTarget.mul(pegPrice);

        // this oracleError is already the combined total oracle error
        uint192 delta = p.mul(oracleError);
        low = p - delta;
        high = p + delta;
    }
}
