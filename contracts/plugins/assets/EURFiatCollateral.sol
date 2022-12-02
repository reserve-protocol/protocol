// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "contracts/plugins/assets/FiatCollateral.sol";
import "contracts/libraries/Fixed.sol";

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
    constructor(
        CollateralConfig memory config,
        AggregatorV3Interface uoaPerTargetFeed_
    ) FiatCollateral(config) {
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
        returns (uint192 low, uint192 high, uint192 pegPrice)
    {
        uint192 refPrice = chainlinkFeed.price(oracleTimeout); // {UoA/ref}
        uint192 targetPrice = uoaPerTargetFeed.price(oracleTimeout); // {UoA/target}

        // div-by-zero later
        if (targetPrice == 0) {
            return (0, FIX_MAX, 0);
        }

        // oracleError is on whatever the _true_ price is, not the one observed
        // this oracleError is already the combined total oracle error
        low = refPrice.div(FIX_ONE.plus(oracleError));
        high = refPrice.div(FIX_ONE.minus(oracleError), CEIL);

        // {target/ref} = {UoA/ref} / {UoA/target}
        pegPrice = refPrice.div(targetPrice);
    }
}
