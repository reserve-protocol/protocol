// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import { IERC4626 } from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "../../libraries/Fixed.sol";

// Simple pass-through wrapper for real MetaMorpho ERC4626 vaults
// Allows settable asset count for testing
contract MockMetaMorpho4626 {
    using FixLib for uint192;

    IERC4626 public immutable actual; // the real ERC4626 vault

    uint192 public multiplier = FIX_ONE;

    // solhint-disable-next-line no-empty-blocks
    constructor(IERC4626 _actual) {
        actual = _actual;
    }

    function applyMultiple(uint192 multiple) external {
        multiplier = multiplier.mul(multiple);
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
