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

    /// @param config.chainlinkFeed Feed units: {target/ref}
    /// @param config.chainlinkFeedAlt1 Feed units: {UoA/target}
    /// @param config.chainlinkFeedAlt1Timeout {s} oracle timeout to use for chainlinkFeedAlt1
    constructor(
        CollateralConfig memory config
    ) FiatCollateral(config) {
        require(address(config.chainlinkFeedAlt1) != address(0), "missing targetUnit feed");
        require(config.chainlinkFeedAlt1Timeout > 0, "chainlinkFeedAlt1Timeout zero");
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

        // {UoA/target}
        uint192 pricePerTarget = chainlinkFeedAlt1.price(chainlinkFeedAlt1Timeout);

        // Assumption: {ref/tok} = 1; inherit from `AppreciatingFiatCollateral` if need appreciation
        // {UoA/tok} = {UoA/target} * {ref/tok} * {target/ref} (1)
        uint192 p = pricePerTarget.mul(pegPrice);

        // this oracleError is already the combined total oracle error
        uint192 delta = p.mul(oracleError);
        low = p - delta;
        high = p + delta;
    }
}
