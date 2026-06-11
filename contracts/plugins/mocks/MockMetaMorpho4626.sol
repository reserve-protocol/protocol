// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.28;

import { IERC4626 } from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "../../libraries/Fixed.sol";
import { IMorphoVaultV2 } from "../assets/meta-morpho/IMorphoVaultV2.sol";

// Simple pass-through wrapper for real MetaMorpho / Morpho Vault V2 ERC4626 vaults
// Allows settable asset count for testing
contract MockMetaMorpho4626 {
    using FixLib for uint192;

    IERC4626 public immutable actual; // the real ERC4626 vault

    uint192 public multiplier = FIX_ONE;

    // Morpho Vault V2 gate test knobs (default: pass through to the wrapped vault)
    address public receiveSharesGateOverride; // if nonzero, returned by receiveSharesGate()
    bool public forceNotAbdicated; // if true, abdicated() returns false

    // solhint-disable-next-line no-empty-blocks
    constructor(IERC4626 _actual) {
        actual = _actual;
    }

    function applyMultiple(uint192 multiple) external {
        multiplier = multiplier.mul(multiple);
    }

    function setReceiveSharesGateOverride(address gate) external {
        receiveSharesGateOverride = gate;
    }

    function setForceNotAbdicated(bool value) external {
        forceNotAbdicated = value;
    }

    // === Morpho Vault V2 gate pass-throughs (only called for V2 collateral) ===

    function receiveSharesGate() external view returns (address) {
        if (receiveSharesGateOverride != address(0)) return receiveSharesGateOverride;
        return IMorphoVaultV2(address(actual)).receiveSharesGate();
    }

    function sendSharesGate() external view returns (address) {
        return IMorphoVaultV2(address(actual)).sendSharesGate();
    }

    function receiveAssetsGate() external view returns (address) {
        return IMorphoVaultV2(address(actual)).receiveAssetsGate();
    }

    function sendAssetsGate() external view returns (address) {
        return IMorphoVaultV2(address(actual)).sendAssetsGate();
    }

    function abdicated(bytes4 selector) external view returns (bool) {
        if (forceNotAbdicated) return false;
        return IMorphoVaultV2(address(actual)).abdicated(selector);
    }

    // === Pass-throughs ===

    function balanceOf(address account) external view returns (uint256) {
        return actual.balanceOf(account);
    }

    function asset() external view returns (address) {
        return actual.asset();
    }

    function decimals() external view returns (uint8) {
        return actual.decimals();
    }

    function convertToAssets(uint256 amount) external view returns (uint256) {
        return multiplier.mulu_toUint(actual.convertToAssets(amount), CEIL);
    }

    function totalAssets() public view returns (uint256) {
        return multiplier.mulu_toUint(actual.totalAssets(), CEIL);
    }
}
