// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.28;

import { CollateralStatus } from "../../../interfaces/IAsset.sol";
import { Asset, CollateralConfig, IRewardable } from "../AppreciatingFiatCollateral.sol";
import { MetaMorphoFiatCollateral } from "./MetaMorphoFiatCollateral.sol";
import { IMorphoVaultV2 } from "./IMorphoVaultV2.sol";
import { IMerklDistributor } from "./IMerklDistributor.sol";

/**
 * @title MorphoV2FiatCollateral
 * @notice Collateral plugin for a Morpho Vault V2 with fiat collateral, like USDC, USDT or PYUSD
 * Expected: {tok} != {ref}, {ref} is pegged to {target} unless defaulting, {target} == {UoA}
 *
 * Pricing is identical to {MetaMorphoFiatCollateral}. This plugin adds gate handling and Merkl
 * reward-claim enablement. Mainnet only.
 *
 * === Gates ===
 * Morpho Vault V2 can install "gates" that restrict share transfers and asset flows.
 *
 * receiveSharesGate / sendSharesGate / receiveAssetsGate are CRITICAL: any of them could block
 * the protocol (or any holder) from holding, trading, or exiting the collateral. These are
 * checked once in the constructor, requiring each to be unset AND its setter abdicated.
 * Abdication is permanent, so a single check is sufficient and costs no runtime gas.
 *
 * sendAssetsGate only gates deposits into the vault -- it can never trap existing shares. But if
 * it is set, no new shares can be minted, so the collateral becomes sourceable only from a thin
 * secondary market. A recollateralization needing to BUY this collateral would then pay a large
 * premium. Its setter is NOT abdicated on most vaults, so it cannot be required in the
 * constructor; instead refresh() marks the collateral IFFY while it is set. IFFY (rather than
 * DISABLED) because a gate can be unset, and this impairs neither refPerTok nor the peg.
 *
 * === Rewards ===
 * Rewards are claimed off-chain via a Merkle proof. Since Morpho moved to Merkl (July 2025),
 * that claim is permissioned. claimRewards() does not claim: it whitelists anyone to claim on
 * behalf of the component holding the collateral (BackingManager / RevenueTrader), with funds
 * always sent to that component. This restores the permissionless off-chain claiming these
 * plugins rely on. See claimRewards() below.
 * For more information:  https://docs.morpho.org/learn/concepts/rewards/
 */
contract MorphoV2FiatCollateral is MetaMorphoFiatCollateral {
    /// Merkl Distributor PROXY on mainnet.
    address public constant MERKL_DISTRIBUTOR = 0x3Ef3D8bA38EBe18DB133cEc108f4D14CE00Dd9Ae;

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

        // Not required to be abdicated (most vaults have not abdicated its setter), but it must
        // not already be set at deployment. refresh() handles it being set later.
        require(vault.sendAssetsGate() == address(0), "sendAssetsGate set");
    }

    /// Should not revert
    /// Refresh exchange rates and update default status.
    function refresh() public virtual override {
        // NOTE: unlike most refresh() override, the super call is FIRST here, and that is
        // required. markStatus(SOUND) resets _whenDefault to NEVER, so marking IFFY before
        // super.refresh() would be silently wiped the moment super saw a healthy price.
        super.refresh();

        // While sendAssetsGate is set, new shares cannot be minted and the collateral is only
        // obtainable on a thin secondary market. Mark IFFY so rebalance() is blocked; escalates
        // to DISABLED after delayUntilDefault if sustained.
        if (IMorphoVaultV2(address(erc20)).sendAssetsGate() != address(0)) {
            CollateralStatus oldStatus = status();
            markStatus(CollateralStatus.IFFY);
            CollateralStatus newStatus = status();

            // super.refresh() emits for its own transition; only emit the one we cause here
            if (oldStatus != newStatus) emit CollateralStatusChanged(oldStatus, newStatus);
        }
    }

    /// Enable permissionless off-chain reward claiming on behalf of the caller.
    /// @dev Does NOT claim. Morpho rewards are claimed off-chain via a Merkle proof; since the
    ///      move to Merkl that claim is permissioned. Approving operator address(0) whitelists
    ///      ANY address to claim on our behalf, with funds always sent to us.
    ///
    ///      toggleOperator() is a TOGGLE and only callable by the account itself, so we read
    ///      first and only ever turn it ON. This is delegatecalled by BackingManager /
    ///      RevenueTrader, so address(this) is that component -- which is both the reward
    ///      recipient and msg.sender for the call, satisfying Merkl's access control.
    ///
    ///      Best-effort: RewardableLib reverts the whole multi-asset claim if this delegatecall
    ///      fails, so a Merkl outage must never brick claimRewards() for every other asset.
    /// @custom:delegate-call
    function claimRewards() external virtual override(Asset, IRewardable) {
        IMerklDistributor merkl = IMerklDistributor(MERKL_DISTRIBUTOR);

        // solhint-disable no-empty-blocks
        try merkl.operators(address(this), address(0)) returns (uint256 approved) {
            if (approved == 0) {
                try merkl.toggleOperator(address(this), address(0)) {} catch {}
            }
        } catch {}
        // solhint-enable no-empty-blocks
    }
}
