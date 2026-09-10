// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.28;

import { CollateralConfig } from "../AppreciatingFiatCollateral.sol";
import { MetaMorphoFiatCollateral } from "./MetaMorphoFiatCollateral.sol";
import { IMorphoVaultV2 } from "./IMorphoVaultV2.sol";

/**
 * @title MorphoV2FiatCollateral
 * @notice Collateral plugin for a Morpho Vault V2 with fiat collateral, like USDC, USDT or PYUSD
 * Expected: {tok} != {ref}, {ref} is pegged to {target} unless defaulting, {target} == {UoA}
 *
 * Pricing and default behavior are identical to {MetaMorphoFiatCollateral}. This plugin only
 * adds a one-time constructor guard that the vault's critical gates are permanently disabled.
 *
 * Morpho Vault V2 can install "gates" that restrict share transfers and asset flows. A
 * receive-shares, send-shares, or receive-assets gate could block the protocol (or any holder)
 * from holding, trading, or exiting the collateral. The check is done in the constructor rather
 * than refresh() because gate abdication is permanent: if a critical gate is unset and its setter
 * is abdicated at construction, it can never be set for the life of the collateral, so a single
 * check is sufficient and costs no runtime gas.
 *
 * sendAssetsGate is intentionally NOT required to be abdicated: it only gates future deposit/mint
 * into the vault, never the transfer or exit of existing shares.
 *
 * Rewards need to be claimed manually, from off-chain. This can be done permissionlessly,
 * by anyone, on behalf of the RToken's Backing Manager address.
 * For more information:  https://docs.morpho.org/learn/concepts/rewards/
 */
contract MorphoV2FiatCollateral is MetaMorphoFiatCollateral {
    /// @param config.erc20 must be a Morpho Vault V2 ERC4626 vault
    /// @param config.chainlinkFeed Feed units: {UoA/ref}
    /// @param revenueHiding {1} A value like 1e-6 that represents the maximum refPerTok to hide
    constructor(CollateralConfig memory config, uint192 revenueHiding)
        MetaMorphoFiatCollateral(config, revenueHiding)
    {
        IMorphoVaultV2 vault = IMorphoVaultV2(address(config.erc20));

        // Each critical gate must be permanently disabled: unset AND its setter abdicated.
        require(
            vault.receiveSharesGate() == address(0) &&
                vault.abdicated(IMorphoVaultV2.setReceiveSharesGate.selector),
            "receiveSharesGate not abdicated"
        );
        require(
            vault.sendSharesGate() == address(0) &&
                vault.abdicated(IMorphoVaultV2.setSendSharesGate.selector),
            "sendSharesGate not abdicated"
        );
        require(
            vault.receiveAssetsGate() == address(0) &&
                vault.abdicated(IMorphoVaultV2.setReceiveAssetsGate.selector),
            "receiveAssetsGate not abdicated"
        );
    }
}
