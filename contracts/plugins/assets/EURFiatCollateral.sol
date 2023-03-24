// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
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

    /// @param config.chainlinkFeed Feed units:{UoA/ref}
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
    /// @return pegPrice {UoA/ref}
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
        uint192 refPrice = chainlinkFeed.price(oracleTimeout); // {UoA/ref}

        // {UoA/target}
        uint192 pricePerTarget = chainlinkFeedAlt1.price(chainlinkFeedAlt1Timeout);

        // div-by-zero later
        if (pricePerTarget == 0) {
            return (0, FIX_MAX, 0);
        }

        uint192 delta = refPrice.mul(oracleError);
        low = refPrice - delta;
        high = refPrice + delta;

        // {target/ref} = {UoA/ref} / {UoA/target}
        pegPrice = refPrice.div(pricePerTarget);
    }
}
