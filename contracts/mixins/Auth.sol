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
     *  - Paused: only allow OWNER actions and redemption
     *
     * Freezing lasts a finite period when performed by the FREEZER, called a oneshot freeze.
     * This also renounces their role as FREEZER, while allowing them to perform the unfreeze.
     * Freezing can also be performed by the OWNER indefinitely. They may also unfreeze anytime.
     */

    // === Freezing ===

    address private frozenBy; // only applies when frozen() is true

    uint32 public unfreezeAt; // {s} uint32.max to pause indefinitely

    uint32 public oneshotFreezeDuration; // {s} length of a oneshot use

    // === Pausing ===

    bool public paused;

    // solhint-disable-next-line func-name-mixedcase
    function __Auth_init(uint32 oneshotPauseDuration_) internal onlyInitializing {
        __AccessControl_init();
        oneshotFreezeDuration = oneshotPauseDuration_;

        // Role setup
        _setRoleAdmin(OWNER, OWNER);
        _setRoleAdmin(FREEZER, OWNER);
        _setRoleAdmin(PAUSER, OWNER);
        _grantRole(OWNER, _msgSender());

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
        frozenBy = address(0);
    }

    function unfreeze() external onlyRole(OWNER) {
        emit UnfreezeAtSet(unfreezeAt, uint32(block.timestamp));
        unfreezeAt = uint32(block.timestamp);
    }

    function oneshotFreeze() external onlyRole(FREEZER) {
        // Revoke role if not also OWNER
        if (!hasRole(OWNER, _msgSender())) _revokeRole(FREEZER, _msgSender());
        emit UnfreezeAtSet(unfreezeAt, uint32(block.timestamp) + oneshotFreezeDuration);
        unfreezeAt = uint32(block.timestamp) + oneshotFreezeDuration;
        frozenBy = _msgSender();
    }

    function unOneshotFreeze() external {
        require(frozen() && frozenBy == _msgSender(), "not original freezer");
        emit UnfreezeAtSet(unfreezeAt, uint32(block.timestamp));
        unfreezeAt = uint32(block.timestamp);
    }

    // === Gov params ===

    function setOneshotFreezeDuration(uint32 oneshotFreezeDuration_) external onlyRole(OWNER) {
        emit OneshotFreezeDurationSet(oneshotFreezeDuration, oneshotFreezeDuration_);
        oneshotFreezeDuration = oneshotFreezeDuration_;
    }
}
