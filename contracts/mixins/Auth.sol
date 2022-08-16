// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "contracts/interfaces/IMain.sol";

uint256 constant LONG_FREEZE_CHARGES = 6; // 6 uses
uint48 constant MAX_UNFREEZE_AT = type(uint48).max;
uint48 constant MAX_SHORT_FREEZE = 2592000; // 1 month
uint48 constant MAX_LONG_FREEZE = 31536000; // 1 year

/**
 * @title Auth
 * @notice Provides fine-grained access controls and exports frozen/paused states to Components.
 */
abstract contract Auth is AccessControlUpgradeable, IAuth {
    /**
     * System-wide states (does not impact ERC20 functions)
     *  - Frozen: only allow OWNER actions and staking
     *  - Paused: only allow OWNER actions, redemption, issuance cancellation, and staking
     *
     * Typically freezing thaws on its own in a predetemined number of blocks.
     *   However, OWNER can also freeze forever.
     */

    /// The rest of the contract uses the shorthand; these declarations are here for getters
    bytes32 public constant OWNER_ROLE = OWNER;
    bytes32 public constant SHORT_FREEZER_ROLE = SHORT_FREEZER;
    bytes32 public constant LONG_FREEZER_ROLE = LONG_FREEZER;
    bytes32 public constant PAUSER_ROLE = PAUSER;

    // === Freezing ===

    mapping(address => uint256) public longFreezes;

    uint48 public unfreezeAt; // {s} uint48.max to pause indefinitely
    uint48 public shortFreeze; // {s} length of an initial freeze
    uint48 public longFreeze; // {s} length of a freeze extension

    // === Pausing ===

    bool public paused;

    // solhint-disable-next-line func-name-mixedcase
    function __Auth_init(uint48 shortFreeze_, uint48 longFreeze_) internal onlyInitializing {
        require(shortFreeze_ > 0 && shortFreeze_ < MAX_SHORT_FREEZE, "short freeze out of range");
        require(longFreeze_ > 0 && longFreeze_ < MAX_LONG_FREEZE, "long freeze out of range");
        __AccessControl_init();
        shortFreeze = shortFreeze_;
        longFreeze = longFreeze_;

        // Role setup
        _setRoleAdmin(OWNER, OWNER);
        _setRoleAdmin(SHORT_FREEZER, OWNER);
        _setRoleAdmin(LONG_FREEZER, OWNER);
        _setRoleAdmin(PAUSER, OWNER);

        address msgSender = _msgSender();
        _grantRole(OWNER, msgSender);
        _grantRole(SHORT_FREEZER, msgSender);
        _grantRole(LONG_FREEZER, msgSender);
        _grantRole(PAUSER, msgSender);
        longFreezes[msgSender] = LONG_FREEZE_CHARGES;
    }

    function grantRole(bytes32 role, address account)
        public
        override(AccessControlUpgradeable, IAccessControlUpgradeable)
        onlyRole(getRoleAdmin(role))
    {
        if (role == LONG_FREEZER) longFreezes[account] = LONG_FREEZE_CHARGES;
        _grantRole(role, account);
    }

    // ==== System-wide views ====

    function frozen() public view returns (bool) {
        return block.timestamp < unfreezeAt;
    }

    /// @dev This -or- condition is a performance optimization for the consuming Component
    function pausedOrFrozen() public view returns (bool) {
        return paused || block.timestamp < unfreezeAt;
    }

    // === Freezing ===

    /// Enter a freeze for the `shortFreeze` duration
    function freezeShort() external onlyRole(SHORT_FREEZER) {
        // Revoke short freezer role after one use
        _revokeRole(SHORT_FREEZER, _msgSender());
        freezeUntil(uint48(block.timestamp) + shortFreeze);
    }

    /// Enter a freeze by the `longFreeze` duration
    function freezeLong() external onlyRole(LONG_FREEZER) {
        longFreezes[_msgSender()] -= 1; // reverts on underflow

        // Revoke on 0 charges as a cleanup step
        if (longFreezes[_msgSender()] == 0) _revokeRole(LONG_FREEZER, _msgSender());
        freezeUntil(uint48(block.timestamp) + longFreeze);
    }

    /// Enter a permanent freeze
    function freezeForever() external onlyRole(OWNER) {
        freezeUntil(MAX_UNFREEZE_AT);
    }

    /// End all freezes
    function unfreeze() external onlyRole(OWNER) {
        emit UnfreezeAtSet(unfreezeAt, uint48(block.timestamp));
        unfreezeAt = uint48(block.timestamp);
    }

    // === Pausing ===

    function pause() external onlyRole(PAUSER) {
        emit PausedSet(paused, true);
        paused = true;
    }

    function unpause() external onlyRole(PAUSER) {
        emit PausedSet(paused, false);
        paused = false;
    }

    // === Gov params ===

    /// @custom:governance
    function setShortFreeze(uint48 shortFreeze_) external onlyRole(OWNER) {
        require(shortFreeze_ > 0 && shortFreeze_ < MAX_SHORT_FREEZE, "short freeze out of range");
        emit ShortFreezeDurationSet(shortFreeze, shortFreeze_);
        shortFreeze = shortFreeze_;
    }

    /// @custom:governance
    function setLongFreeze(uint48 longFreeze_) external onlyRole(OWNER) {
        require(longFreeze_ > 0 && longFreeze_ < MAX_LONG_FREEZE, "long freeze out of range");
        emit LongFreezeDurationSet(longFreeze, longFreeze_);
        longFreeze = longFreeze_;
    }

    // === Private Helper ===

    function freezeUntil(uint48 newUnfreezeAt) private {
        require(newUnfreezeAt > unfreezeAt, "frozen");
        emit UnfreezeAtSet(unfreezeAt, newUnfreezeAt);
        unfreezeAt = newUnfreezeAt;
    }
}
