// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import { CollateralConfig } from "../AppreciatingFiatCollateral.sol";
import { MetaMorphoCollateral } from "./MetaMorphoCollateral.sol";

/**
 * @title MetaMorphoFiatCollateral
 * @notice Collateral plugin for a MetaMorpho vault with fiat collateral, like USDC or USDT
 * Expected: {tok} != {ref}, {ref} is pegged to {target} unless defaulting, {target} == {UoA}
 */
contract MetaMorphoFiatCollateral is MetaMorphoCollateral {
    /// config.erc20 must be a MetaMorpho ERC4626 vault
    /// @param config.chainlinkFeed Feed units: {UoA/ref}
    /// @param revenueHiding {1} A value like 1e-6 that represents the maximum refPerTok to hide
    constructor(CollateralConfig memory config, uint192 revenueHiding)
        MetaMorphoCollateral(config, revenueHiding)
    {
        require(config.defaultThreshold > 0, "defaultThreshold zero");
    }
}
