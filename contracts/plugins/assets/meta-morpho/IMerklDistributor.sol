// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.28;

/**
 * @title IMerklDistributor
 * @notice Minimal interface for the Merkl Distributor's operator permission system.
 *
 * Morpho migrated reward distribution from its legacy UniversalRewardsDistributor to Merkl in
 * July 2025. The legacy contract's `claim()` had no access control, so anyone could claim on
 * behalf of any account. Merkl's `_claim()` instead requires msg.sender to be the recipient, an
 * approved operator, or a governor/guardian.
 *
 * Setting the operator to `address(0)` whitelists *anyone* to claim on the recipient's behalf,
 * which restores the permissionless off-chain claiming these plugins rely on.
 */
interface IMerklDistributor {
    /// @return 1 if `operator` may claim on behalf of `user`, else 0
    function operators(address user, address operator) external view returns (uint256);

    /// @notice Flips operator approval. Callable only by `user` themselves (or a governor).
    /// @dev This is a TOGGLE -- calling it when already enabled would DISABLE it. Always read
    ///      `operators()` first and only call when currently 0.
    function toggleOperator(address user, address operator) external;
}
