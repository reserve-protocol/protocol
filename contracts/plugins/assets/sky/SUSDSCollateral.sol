// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "../../../libraries/Fixed.sol";
import "../AppreciatingFiatCollateral.sol";
import "./vendor/ISUsds.sol";

/**
 * @title SUSDS Collateral
 * @notice Collateral plugin for the SSR wrapper sUSDS
 * tok = SUSDS (transferrable SSR-locked USDS)
 * ref = USDS
 * tar = USD
 * UoA = USD
 */
contract SUSDSCollateral is AppreciatingFiatCollateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    /// @param config.chainlinkFeed {UoA/ref} price of USDS in USD terms
    constructor(CollateralConfig memory config, uint192 revenueHiding)
        AppreciatingFiatCollateral(config, revenueHiding)
    {
        require(config.defaultThreshold != 0, "defaultThreshold zero");
    }

    /// @return {ref/tok} Actual quantity of whole reference units per whole collateral tokens
    function underlyingRefPerTok() public view override returns (uint192) {
        return shiftl_toFix(ISUsds(address(erc20)).chi(), -27, FLOOR);
    }
}
