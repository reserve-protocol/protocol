// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "../ERC4626FiatCollateral.sol";

/**
 * @title SUSDS Collateral
 * @notice Collateral plugin for the SSR wrapper sUSDS
 * tok = SUSDS (transferrable SSR-locked USDS)
 * ref = USDS
 * tar = USD
 * UoA = USD
 */
contract SUSDSCollateral is ERC4626FiatCollateral {
    /// @param config.chainlinkFeed {UoA/ref} price of USDS in USD terms
    constructor(CollateralConfig memory config, uint192 revenueHiding)
        ERC4626FiatCollateral(config, revenueHiding)
    {
        require(config.defaultThreshold != 0, "defaultThreshold zero");
    }
}
