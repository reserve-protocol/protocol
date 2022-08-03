// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "contracts/interfaces/IMain.sol";

/**
 * @title Auth
 * @notice Provides fine-grained access controls and exports frozen/paused states to Components.
 */
abstract contract Auth is AccessControlUpgradeable, IAuth {
    /**
     * System-wide states
     *  - Frozen: only allow OWNER actions
     *  - Paused: only allow OWNER actions and redemption (and issuance cancellation)
     *
     * Typically freezing thaws on its own in a predetemined number of blocks.
     *   However, OWNER can also freeze forever.
     */

    /// The rest of the contract uses the shorthand; these declarations are here for getters
    bytes32 public constant OWNER_ROLE = OWNER;
    bytes32 public constant FREEZE_STARTER_ROLE = FREEZE_STARTER;
    bytes32 public constant FREEZE_EXTENDER_ROLE = FREEZE_EXTENDER;
    bytes32 public constant PAUSER_ROLE = PAUSER;

    // === Freezing ===

    uint32 public unfreezeAt; // {s} uint32.max to pause indefinitely

    uint32 public freezeDuration; // {s} length of a oneshot use

    bool public foreverFrozen;

    // === Pausing ===

    bool public paused;

    // solhint-disable-next-line func-name-mixedcase
    function __Auth_init(uint32 freezeDuration_) internal onlyInitializing {
        __AccessControl_init();
        freezeDuration = freezeDuration_;

        // Role setup
        _setRoleAdmin(OWNER, OWNER);
        _setRoleAdmin(FREEZE_STARTER, OWNER);
        _setRoleAdmin(FREEZE_EXTENDER, OWNER);
        _setRoleAdmin(PAUSER, OWNER);
        _grantRole(OWNER, _msgSender());
        _grantRole(FREEZE_STARTER, _msgSender());
        _grantRole(FREEZE_EXTENDER, _msgSender());
        _grantRole(PAUSER, _msgSender());

        // Begin forever-frozen
        foreverFrozen = true;
    }

    // ==== System-wide views ====

    function frozen() public view returns (bool) {
        return foreverFrozen || block.timestamp < unfreezeAt;
    }

    /// @dev This -or- condition is a performance optimization for the consuming Component
    function pausedOrFrozen() public view returns (bool) {
        return paused || foreverFrozen || block.timestamp < unfreezeAt;
    }

    // === Freezing ===

    /// Enter a forever-freeze
    function freezeForever() external onlyRole(OWNER) {
        emit ForeverFrozenSet(foreverFrozen, true);
        foreverFrozen = true;
    }

    /// Enter a fixed-duration freeze and revoke freezership
    /// onlyRole(FREEZE_STARTER or FREEZE_EXTENDER)
    function freeze() external {
        if (block.timestamp < unfreezeAt) {
            require(hasRole(FREEZE_EXTENDER, _msgSender()), "not freeze extender");
        } else {
            // Revoke role if starting the freeze
            require(hasRole(FREEZE_STARTER, _msgSender()), "not freeze starter");
            _revokeRole(FREEZE_STARTER, _msgSender());
        }
        emit UnfreezeAtSet(unfreezeAt, uint32(block.timestamp) + freezeDuration);
        unfreezeAt = uint32(block.timestamp) + freezeDuration;
    }

    /// End all freezes
    function unfreeze() external onlyRole(OWNER) {
        emit ForeverFrozenSet(foreverFrozen, false);
        foreverFrozen = false;

        emit UnfreezeAtSet(unfreezeAt, uint32(block.timestamp));
        unfreezeAt = uint32(block.timestamp);
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

    function setOneshotFreezeDuration(uint32 freezeDuration_) external onlyRole(OWNER) {
        emit OneshotFreezeDurationSet(freezeDuration, freezeDuration_);
        freezeDuration = freezeDuration_;
    }
}
