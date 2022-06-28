// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "contracts/interfaces/IMain.sol";

/**
 * @title StateManager
 * @notice Abstract class that provides fine-grained access controls to support state management
 */
abstract contract StateManager is AccessControlUpgradeable, IStateManager {
    // === Full Pausing ===

    uint32 public unpauseAt; // {s} 0 when not paused, uint32.max to pause indefinitely

    uint32 public oneshotPauseDuration; // {s} gov param that controls length of a oneshot pause

    // === Lite Pausing ===

    bool public litePause;

    // solhint-disable-next-line func-name-mixedcase
    function __StateManager_init(uint32 oneshotPauseDuration_) internal onlyInitializing {
        __AccessControl_init();
        oneshotPauseDuration = oneshotPauseDuration_;

        // Role setup
        _setRoleAdmin(OWNER, OWNER);
        _setRoleAdmin(PAUSER, OWNER);
        _setRoleAdmin(PAUSER_LITE, OWNER);
        _grantRole(OWNER, _msgSender());

        // begin paused
        unpauseAt = type(uint32).max;
    }

    // ==== States ====

    function fullyPaused() public view returns (bool) {
        return block.timestamp < unpauseAt;
    }

    function paused() public view returns (bool) {
        return (block.timestamp < unpauseAt) || litePause;
    }

    // ==== State Transitions ====

    function pause() external onlyRole(OWNER) {
        emit UnpauseAtSet(unpauseAt, type(uint32).max);
        unpauseAt = type(uint32).max;
    }

    function unpause() external onlyRole(OWNER) {
        emit UnpauseAtSet(unpauseAt, uint32(block.timestamp));
        unpauseAt = uint32(block.timestamp);
    }

    function pauseTemporarily() external onlyRole(PAUSER) {
        // Revoke role if not also OWNER
        if (!hasRole(OWNER, _msgSender())) _revokeRole(PAUSER, _msgSender());
        emit UnpauseAtSet(unpauseAt, uint32(block.timestamp) + oneshotPauseDuration);
        unpauseAt = uint32(block.timestamp) + oneshotPauseDuration;
    }

    function setLitePause(bool litePause_) external onlyRole(PAUSER_LITE) {
        emit LitePauseSet(litePause, litePause_);
        litePause = litePause_;
    }

    // === Gov params ===

    function setOneshotPauseDuration(uint32 oneshotPauseDuration_) external onlyRole(OWNER) {
        emit OneshotPauseDurationSet(oneshotPauseDuration, oneshotPauseDuration_);
        oneshotPauseDuration = oneshotPauseDuration_;
    }

    // === Things we are forced to override ===

    function hasRole(bytes32 role, address account)
        public
        view
        override(AccessControlUpgradeable, IAccessControlUpgradeable)
        returns (bool)
    {
        return super.hasRole(role, account);
    }

    function getRoleAdmin(bytes32 role)
        public
        view
        override(AccessControlUpgradeable, IAccessControlUpgradeable)
        returns (bytes32)
    {
        return super.getRoleAdmin(role);
    }

    function grantRole(bytes32 role, address account)
        public
        override(AccessControlUpgradeable, IAccessControlUpgradeable)
        onlyRole(getRoleAdmin(role))
    {
        super.grantRole(role, account);
    }

    function revokeRole(bytes32 role, address account)
        public
        override(AccessControlUpgradeable, IAccessControlUpgradeable)
        onlyRole(getRoleAdmin(role))
    {
        super.revokeRole(role, account);
    }

    function renounceRole(bytes32 role, address account)
        public
        override(AccessControlUpgradeable, IAccessControlUpgradeable)
    {
        super.renounceRole(role, account);
    }
}
