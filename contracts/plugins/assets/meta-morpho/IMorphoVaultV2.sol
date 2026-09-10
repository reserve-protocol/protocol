// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.28;

/**
 * @title IMorphoVaultV2
 * @notice Minimal interface for the gate + abdication surface of a Morpho Vault V2.
 *
 * Gates are optional external contracts that can restrict share transfers and asset flows.
 * A gate setter that has been "abdicated" can never be called again, so a gate that is
 * currently unset (`address(0)`) with an abdicated setter is permanently disabled.
 */
interface IMorphoVaultV2 {
    // === Gate getters ===
    function receiveSharesGate() external view returns (address);

    function sendSharesGate() external view returns (address);

    function receiveAssetsGate() external view returns (address);

    function sendAssetsGate() external view returns (address);

    /// @return Whether `selector` has been permanently abdicated (can no longer be called)
    function abdicated(bytes4 selector) external view returns (bool);

    // === Gate setters ===
    // Declared only so their `.selector` can be referenced when checking abdication.
    function setReceiveSharesGate(address newReceiveSharesGate) external;

    function setSendSharesGate(address newSendSharesGate) external;

    function setReceiveAssetsGate(address newReceiveAssetsGate) external;

    function setSendAssetsGate(address newSendAssetsGate) external;
}
