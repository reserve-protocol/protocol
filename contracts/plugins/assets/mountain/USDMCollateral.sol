// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "../../../libraries/Fixed.sol";
import "../ERC4626FiatCollateral.sol";

/**
 * @title USDM Collateral
 * @notice Collateral plugin for USDM (Mountain Protocol)
 * tok = wUSDM (ERC4626 vault)
 * ref = USDM
 * tar = USD
 * UoA = USD
 *
 * Note: Uses a Chronicle Oracle, which requires the plugin address to be whitelisted
 */

contract USDMCollateral is ERC4626FiatCollateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    // solhint-disable no-empty-blocks

    /// @param config.chainlinkFeed - {UoA/tok} - Chronicle oracle - Requires whitelisting!
    constructor(CollateralConfig memory config, uint192 revenueHiding)
        ERC4626FiatCollateral(config, revenueHiding)
    {
        require(config.defaultThreshold != 0, "defaultThreshold zero");
    }

    /// Can revert, used by other contract functions in order to catch errors
    /// Should not return FIX_MAX for low
    /// Should only return FIX_MAX for high if low is 0
    /// Should NOT be manipulable by MEV
    /// @return low {UoA/tok} The low price estimate
    /// @return high {UoA/tok} The high price estimate
    /// @return pegPrice {target/ref} The actual price observed in the peg
    function tryPrice()
        external
        view
        virtual
        override
        returns (
            uint192 low,
            uint192 high,
            uint192 pegPrice
        )
    {
        // {UoA/tok}
        uint192 p = chainlinkFeed.price(oracleTimeout);
        uint192 err = p.mul(oracleError, CEIL);

        low = p - err;
        high = p + err;
        // assert(low <= high); obviously true just by inspection

        // {target/ref} = {UoA/ref} = {UoA/tok} / {ref/tok}
        pegPrice = p.div(underlyingRefPerTok());
    }
}
