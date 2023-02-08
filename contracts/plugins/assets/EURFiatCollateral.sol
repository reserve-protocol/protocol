// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "../../libraries/Fixed.sol";
import "./FiatCollateral.sol";

/**
 * @title EURFiatCollateral
 * @notice Collateral plugin for a EURO fiatcoin collateral, like EURT
 * Expected: {tok} == {ref}, {ref} is pegged to {target} or defaults, {target} != {UoA}
 */
contract EURFiatCollateral is FiatCollateral {
    using FixLib for uint192;
    using OracleLib for AggregatorV3Interface;

    AggregatorV3Interface public immutable uoaPerTargetFeed; // {UoA/target}

    /// @param config.chainlinkFeed Feed units:{UoA/ref}
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
    /// @param pegPrice {UoA/ref}
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
        uint192 targetPrice = uoaPerTargetFeed.price(oracleTimeout); // {UoA/target}

        // div-by-zero later
        if (targetPrice == 0) {
            return (0, FIX_MAX, 0);
        }

        uint192 delta = refPrice.mul(oracleError);
        low = refPrice - delta;
        high = refPrice + delta;

        // {target/ref} = {UoA/ref} / {UoA/target}
        pegPrice = refPrice.div(targetPrice);
    }
}
