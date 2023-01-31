// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

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

    AggregatorV3Interface public immutable uoaPerTargetFeed; // {UoA/target}

    /// @param config.chainlinkFeed Feed units: {target/ref}
    /// @param uoaPerTargetFeed_ Feed units: {UoA/target}
    constructor(CollateralConfig memory config, AggregatorV3Interface uoaPerTargetFeed_)
        FiatCollateral(config)
    {
        require(address(uoaPerTargetFeed_) != address(0), "missing uoaPerTarget feed");
        uoaPerTargetFeed = uoaPerTargetFeed_;
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
        uint192 pricePerTarget = uoaPerTargetFeed.price(oracleTimeout); // {UoA/target}

        // {UoA/tok} = {UoA/target} * {target/ref} * {ref/tok}
        uint192 p = pricePerTarget.mul(pegPrice);

        // this oracleError is already the combined total oracle error
        uint192 delta = p.mul(oracleError);
        low = p - delta;
        high = p + delta;
    }
}
