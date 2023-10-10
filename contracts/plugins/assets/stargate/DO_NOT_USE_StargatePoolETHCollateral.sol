// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "../../../libraries/Fixed.sol";
import "../OracleLib.sol";
import "./interfaces/IStargatePool.sol";
import "./StargatePoolFiatCollateral.sol";

/**
 * ************************************************************
 * WARNING: this plugin is DEPRECATED!
 * Not ready to be deployed and used in Production environments
 * ************************************************************
 */

/**
 * @title StargatePoolETHCollateral (DO NOT USE)
 * @notice Collateral plugin for Stargate ETH,
 * tok = wstgETH
 * ref = ETH
 * tar = ETH
 * UoA = USD
 */

contract StargatePoolETHCollateral is StargatePoolFiatCollateral {
    using FixLib for uint192;
    using OracleLib for AggregatorV3Interface;

    /// @param config.chainlinkFeed Feed units: {UoA/target}
    // solhint-disable no-empty-blocks
    constructor(CollateralConfig memory config, uint192 revenueHiding)
        StargatePoolFiatCollateral(config, revenueHiding)
    {}

    /// Can revert, used by other contract functions in order to catch errors
    /// Should not return FIX_MAX for low
    /// Should only return FIX_MAX for high if low is 0
    /// @dev Override this when pricing is more complicated than just a single oracle
    /// @param low {UoA/tok} The low price estimate
    /// @param high {UoA/tok} The high price estimate
    /// @param pegPrice {target/ref} The actual price observed in the peg
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
        // Assumption: {target/ref} = 1; SGETH unwraps to ETH at 1:1
        pegPrice = FIX_ONE; // {target/ref}

        // {UoA/target}
        uint192 pricePerTarget = chainlinkFeed.price(oracleTimeout);

        // {UoA/tok} = {UoA/target} * {ref/tok} * {target/ref} (1)
        uint192 p = pricePerTarget.mul(refPerTok());

        // this oracleError is already the combined total oracle error
        uint192 delta = p.mul(oracleError);
        low = p - delta;
        high = p + delta;
    }
}
