// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import { CollateralConfig } from "../AppreciatingFiatCollateral.sol";
import { ERC4626FiatCollateral } from "../ERC4626FiatCollateral.sol";

/**
 * @title USDA Fiat Collateral
 * @notice Collateral plugin for USDA (Angle)
 * tok = stUSD (ERC4626 vault)
 * ref = USDA
 * tar = USD
 * UoA = USD
 */

contract USDAFiatCollateral is ERC4626FiatCollateral {
    /// config.erc20 must be stUSD
    /// @param config.chainlinkFeed Feed units: {UoA/ref}
    /// @param revenueHiding {1} A value like 1e-6 that represents the maximum refPerTok to hide
    constructor(CollateralConfig memory config, uint192 revenueHiding)
        ERC4626FiatCollateral(config, revenueHiding)
    {
        require(config.defaultThreshold != 0, "defaultThreshold zero");
    }
}
