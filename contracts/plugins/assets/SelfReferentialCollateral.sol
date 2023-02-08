// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "../../libraries/Fixed.sol";
import "./FiatCollateral.sol";

/**
 * @title SelfReferentialCollateral
 * @notice Collateral plugin for an unpegged collateral, such as wETH.
 * Expected: {tok} == {ref}, {ref} == {target}, {target} != {UoA}
 */
contract SelfReferentialCollateral is FiatCollateral {
    using FixLib for uint192;
    using OracleLib for AggregatorV3Interface;

    /// @param config.chainlinkFeed Feed units: {UoA/ref}
    constructor(CollateralConfig memory config) FiatCollateral(config) {
        require(config.defaultThreshold == 0, "default threshold not supported");
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
        // {UoA/tok} = {UoA/ref} * {ref/tok} (1)
        uint192 p = chainlinkFeed.price(oracleTimeout);
        // danger for inheritance: this assumes refPerTok() is 1

        uint192 delta = p.mul(oracleError);

        low = p - delta;
        high = p + delta;
        pegPrice = targetPerRef();
    }
}
