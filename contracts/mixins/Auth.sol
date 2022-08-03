// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "contracts/interfaces/IMain.sol";

uint32 constant INDEFINITE_FREEZE = type(uint32).max;

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
     * There are two types of freezes: regular freezes and oneshot freezes
     * - Regular freeze: Freeze indefinitely; only callable by OWNER
     * - Oneshot freeze: Freeze for a fixed duration, thawing at a predetermined timestamp
     *     When a oneshot freeze is performed by a non-OWNER, the address loses FREEZER status
     *     The THAWER may unfreeze early or extend the freeze, without loss of role.
     */

    /// The rest of the contract uses the shorthand; this is just to generate getters
    bytes32 public constant OWNER_ROLE = OWNER; // role admin for all roles
    bytes32 public constant FREEZER_ROLE = FREEZER; // role able to enter freezing state
    bytes32 public constant THAWER_ROLE = THAWER; // role able to extend or exit freezing state
    bytes32 public constant PAUSER_ROLE = PAUSER; // role able to pause or unpause

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
        _setRoleAdmin(THAWER, OWNER);
        _setRoleAdmin(PAUSER, OWNER);
        _grantRole(OWNER, _msgSender());
        _grantRole(FREEZER, _msgSender());
        _grantRole(THAWER, _msgSender());
        _grantRole(PAUSER, _msgSender());

        // begin frozen
        unfreezeAt = INDEFINITE_FREEZE;
    }

    // ==== System-wide views ====

    function pausedOrFrozen() public view returns (bool) {
        return paused || block.timestamp < unfreezeAt;
    }

    function frozen() public view returns (bool) {
        return block.timestamp < unfreezeAt;
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

    // === Freezing ===

    /// Enter an indefinite freeze
    function freeze() external onlyRole(OWNER) {
        require(!isFrozenIndefinitely(), "already indefinitely frozen");
        emit UnfreezeAtSet(unfreezeAt, INDEFINITE_FREEZE);
        unfreezeAt = INDEFINITE_FREEZE;
    }

    /// Enter a fixed-duration freeze
    function oneshotFreeze() external onlyRole(FREEZER) {
        require(!frozen(), "frozen: use extendFreeze");

        // Revoke role if not also OWNER
        if (!hasRole(OWNER, _msgSender())) _revokeRole(FREEZER, _msgSender());
        emit UnfreezeAtSet(unfreezeAt, uint32(block.timestamp) + oneshotFreezeDuration);
        unfreezeAt = uint32(block.timestamp) + oneshotFreezeDuration;
    }

    /// Extend an ongoing oneshot freeze
    function extendOneshotFreeze() external onlyRole(THAWER) {
        require(frozen() && !isFrozenIndefinitely(), "not oneshot frozen");
        emit UnfreezeAtSet(unfreezeAt, uint32(block.timestamp) + oneshotFreezeDuration);
        unfreezeAt = uint32(block.timestamp) + oneshotFreezeDuration;
    }

    /// Exit a freeze; require caller is also OWNER if freeze is indefinite
    function unfreeze() external onlyRole(THAWER) {
        require(frozen(), "not frozen");

        // if frozen indefinitely: require the THAWER is also OWNER
        require(!isFrozenIndefinitely() || hasRole(OWNER, _msgSender()), "owner only");
        emit UnfreezeAtSet(unfreezeAt, uint32(block.timestamp));
        unfreezeAt = uint32(block.timestamp);
    }

    // === Gov params ===

    function setOneshotFreezeDuration(uint32 oneshotFreezeDuration_) external onlyRole(OWNER) {
        emit OneshotFreezeDurationSet(oneshotFreezeDuration, oneshotFreezeDuration_);
        oneshotFreezeDuration = oneshotFreezeDuration_;
    }

    function isFrozenIndefinitely() private view returns (bool) {
        return unfreezeAt == INDEFINITE_FREEZE;
    }
}
