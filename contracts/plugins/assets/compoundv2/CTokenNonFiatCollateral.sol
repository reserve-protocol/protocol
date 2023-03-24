// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "../../../libraries/Fixed.sol";
import "../OracleLib.sol";
import "./CTokenFiatCollateral.sol";
import "./ICToken.sol";

/**
 * @title CTokenNonFiatCollateral
 * @notice Collateral plugin for a cToken of nonfiat collateral that requires default checks,
 * like cWBTC. Expected: {tok} != {ref}, {ref} == {target}, {target} != {UoA}
 */
contract CTokenNonFiatCollateral is CTokenFiatCollateral {
    using FixLib for uint192;
    using OracleLib for AggregatorV3Interface;

    /// @param config.chainlinkFeed Feed units: {target/ref}
    /// @param revenueHiding {1} A value like 1e-6 that represents the maximum refPerTok to hide
    /// @param comptroller_ The CompoundFinance Comptroller
    constructor(
        CollateralConfig memory config,
        uint192 revenueHiding,
        IComptroller comptroller_
    ) CTokenFiatCollateral(config, revenueHiding, comptroller_) {
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

        // {UoA/tok} = {UoA/target} * {target/ref} * {ref/tok}
        uint192 pLow = pricePerTarget.mul(pegPrice).mul(refPerTok());

        // {UoA/tok} = {UoA/target} * {target/ref} * {ref/tok}
        uint192 pHigh = pricePerTarget.mul(pegPrice).mul(_underlyingRefPerTok());

        low = pLow - pLow.mul(oracleError);
        high = pHigh + pHigh.mul(oracleError);
    }
}
