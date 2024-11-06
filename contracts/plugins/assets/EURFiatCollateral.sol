// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "../../libraries/Fixed.sol";
import "./FiatCollateral.sol";

/**
 * @title EURFiatCollateral
 * @notice Collateral plugin for a EUR fiatcoin collateral, like EURT
 * Expected: {tok} == {ref}, {ref} is pegged to {target} or defaults, {target} != {UoA}
 */
contract EURFiatCollateral is FiatCollateral {
    using FixLib for uint192;
    using OracleLib for AggregatorV3Interface;

    AggregatorV3Interface public immutable targetUnitChainlinkFeed; // {UoA/target}
    uint48 public immutable targetUnitOracleTimeout; // {s}

    /// @param config.chainlinkFeed Feed units:{UoA/ref}
    /// @param targetUnitChainlinkFeed_ Feed units: {UoA/target}
    /// @param targetUnitOracleTimeout_ {s} oracle timeout to use for targetUnitChainlinkFeed
    constructor(
        CollateralConfig memory config,
        AggregatorV3Interface targetUnitChainlinkFeed_,
        uint48 targetUnitOracleTimeout_
    ) FiatCollateral(config) {
        require(address(targetUnitChainlinkFeed_) != address(0), "missing targetUnit feed");
        require(targetUnitOracleTimeout_ != 0, "targetUnitOracleTimeout zero");
        require(config.defaultThreshold != 0, "defaultThreshold zero");

        targetUnitChainlinkFeed = targetUnitChainlinkFeed_;
        targetUnitOracleTimeout = targetUnitOracleTimeout_;
        maxOracleTimeout = uint48(Math.max(maxOracleTimeout, targetUnitOracleTimeout_));
    }

    /// Can revert, used by other contract functions in order to catch errors
    /// Should NOT be manipulable by MEV
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
        uint192 pricePerRef = chainlinkFeed.price(oracleTimeout); // {UoA/ref}

        // {UoA/target}
        uint192 pricePerTarget = targetUnitChainlinkFeed.price(targetUnitOracleTimeout);

        // div-by-zero later
        // untestable:
        //      calls to price() on the feed never return zero if using OracleLib
        if (pricePerTarget == 0) {
            return (0, FIX_MAX, 0);
        }

        uint192 err = pricePerRef.mul(oracleError, CEIL);

        low = pricePerRef - err;
        high = pricePerRef + err;
        // assert(low <= high); obviously true just by inspection

        // {target/ref} = {UoA/ref} / {UoA/target}
        pegPrice = pricePerRef.div(pricePerTarget);
    }
}
