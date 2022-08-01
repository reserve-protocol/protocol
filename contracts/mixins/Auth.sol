// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "contracts/interfaces/IMain.sol";

/**
 * @title Auth
 * @notice Provides fine-grained access controls and exports frozen/paused states to Components.
 */
abstract contract Auth is AccessControlUpgradeable, IAuth {
    /// To generate getters
    bytes32 public constant OWNER_ROLE = OWNER;
    bytes32 public constant FREEZER_ROLE = FREEZER;
    bytes32 public constant FREEZE_EXTENDER_ROLE = FREEZE_EXTENDER;
    bytes32 public constant PAUSER_ROLE = PAUSER;

    /**
     * System-wide states
     *  - Frozen: only allow OWNER actions
     *  - Paused: only allow OWNER actions and redemption (+ issuance cancellation)
     *
     * Freezing lasts a finite period when performed by the FREEZER, called a oneshot freeze.
     * This also renounces their role as FREEZER, while allowing them to perform the unfreeze.
     * After this, the FREEZE_EXTENDER can extend the freeze arbitrarily or unfreeze.
     *
     * Freezing can also be performed by the OWNER indefinitely. They may also unfreeze anytime.
     */

    // === Freezing ===

    uint32 public unfreezeAt; // {s} uint32.max to pause indefinitely

    uint32 public oneshotFreezeDuration; // {s} length of a oneshot use

    // === Pausing ===

    bool public paused;

    // solhint-disable-next-line func-name-mixedcase
    function __Auth_init(uint32 oneshotFreezeDuration_) internal onlyInitializing {
        __AccessControl_init();
        oneshotFreezeDuration = oneshotFreezeDuration_;

        // Role setup
        _setRoleAdmin(OWNER, OWNER);
        _setRoleAdmin(FREEZER, OWNER);
        _setRoleAdmin(FREEZE_EXTENDER, OWNER);
        _setRoleAdmin(PAUSER, OWNER);
        _grantRole(OWNER, _msgSender());
        _grantRole(FREEZER, _msgSender());
        _grantRole(FREEZE_EXTENDER, _msgSender());
        _grantRole(PAUSER, _msgSender());

        // begin frozen
        unfreezeAt = type(uint32).max;
    }

    // ==== System-wide states ====

    function pausedOrFrozen() public view returns (bool) {
        return paused || block.timestamp < unfreezeAt;
    }

    function frozen() public view returns (bool) {
        return block.timestamp < unfreezeAt;
    }

    // ==== Access-controlled state transitions ====

    function pause() external onlyRole(PAUSER) {
        emit PausedSet(paused, true);
        paused = true;
    }

    function unpause() external onlyRole(PAUSER) {
        emit PausedSet(paused, false);
        paused = false;
    }

    function freeze() external onlyRole(OWNER) {
        emit UnfreezeAtSet(unfreezeAt, type(uint32).max);
        unfreezeAt = type(uint32).max;
    }

    function unfreeze() external {
        require(frozen(), "not frozen");
        require(hasRole(FREEZE_EXTENDER, _msgSender()), "not freeze extender");
        emit UnfreezeAtSet(unfreezeAt, uint32(block.timestamp));
        unfreezeAt = uint32(block.timestamp);
    }

    function oneshotFreeze() external onlyRole(FREEZER) {
        // Revoke role if not also OWNER
        if (!hasRole(OWNER, _msgSender())) _revokeRole(FREEZER, _msgSender());
        emit UnfreezeAtSet(unfreezeAt, uint32(block.timestamp) + oneshotFreezeDuration);
        unfreezeAt = uint32(block.timestamp) + oneshotFreezeDuration;
    }

    function extendFreeze() external onlyRole(FREEZE_EXTENDER) {
        require(frozen(), "not frozen");
        require(hasRole(FREEZE_EXTENDER, _msgSender()), "not freeze extender");
        emit UnfreezeAtSet(unfreezeAt, uint32(block.timestamp) + oneshotFreezeDuration);
        unfreezeAt = uint32(block.timestamp) + oneshotFreezeDuration;
    }

    // === Gov params ===

    function setOneshotFreezeDuration(uint32 oneshotFreezeDuration_) external onlyRole(OWNER) {
        emit OneshotFreezeDurationSet(oneshotFreezeDuration, oneshotFreezeDuration_);
        oneshotFreezeDuration = oneshotFreezeDuration_;
    }
}
