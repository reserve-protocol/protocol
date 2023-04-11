// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "../aave/ATokenFiatCollateral.sol";
import "../../../libraries/Fixed.sol";
import "../OracleLib.sol";

/**
 * @title BendWethCollateral
 * @notice Collateral plugin for BendDAO supplied ETH
 * tok = sBendWETH (Static Bend interest bearing WETH)
 * ref = WETH
 * tar = ETH
 * UoA = USD
 */
contract BendWethCollateral is ATokenFiatCollateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    constructor(CollateralConfig memory config, uint192 revenueHiding)
        ATokenFiatCollateral(config, revenueHiding)
    {}

    /// Can revert, used by other contract functions in order to catch errors
    /// @return low {UoA/tok} The low price estimate
    /// @return high {UoA/tok} The high price estimate
    /// @return pegPrice {target/ref} FIX_ONE
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
        // FIX_ONE
        pegPrice = targetPerRef();

        // {UoA/target}
        uint192 p = chainlinkFeed.price(oracleTimeout);

        // {UoA/tok} = {UoA/target} * {ref/tok} * {target/ref} (1)
        uint192 pLow = p.mul(refPerTok());

        // {UoA/tok} = {UoA/target} * {ref/tok} * {target/ref} (1)
        uint192 pHigh = p.mul(_underlyingRefPerTok());

        low = pLow - pLow.mul(oracleError);
        high = pHigh + pHigh.mul(oracleError);
    }
}
