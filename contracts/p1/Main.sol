// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/interfaces/IMain.sol";
import "contracts/mixins/GlobalLock.sol";
import "contracts/mixins/ComponentRegistry.sol";
import "contracts/mixins/Pausable.sol";

/**
 * @title Main
 * @notice The center of the system around which Components orbit.
 */
// solhint-disable max-states-count
contract MainP1 is
    Initializable,
    ContextUpgradeable,
    ComponentRegistry,
    Pausable,
    GlobalLock,
    UUPSUpgradeable,
    IMain
{
    IERC20 public rsr;

    /// @custom:oz-upgrades-unsafe-allow constructor
    // solhint-disable-next-line no-empty-blocks
    constructor() initializer {}

    /// @dev This should not need to be used from anywhere other than the Facade
    function poke() external virtual {
        assetRegistry.forceUpdates();
        if (!paused()) {
            furnace.melt();
            stRSR.payoutRewards();
        }
    }

    function owner() public view override(IMain, OwnableUpgradeable) returns (address) {
        return OwnableUpgradeable.owner();
    }

    /// Initializer
    function init(
        Components memory components,
        IERC20 rsr_,
        uint32 oneshotPauseDuration_
    ) public virtual initializer {
        __Pausable_init(oneshotPauseDuration_);
        __ComponentRegistry_init(components);
        __GlobalLock_init();
        __UUPSUpgradeable_init();

        rsr = rsr_;

        emit MainInitialized();
    }

    // solhint-disable-next-line func-mixed-case
    function lock_notPaused() external virtual {
        // We can lock without ensuring the caller is a component
        require(!paused(), "paused");
        _lock();
    }

    function lock() external virtual {
        // We can lock without ensuring the caller is a component
        _lock();
    }

    function unlock() external virtual onlyComponent {
        _unlock();
    }

    // === Upgradeability ===
    // solhint-disable-next-line no-empty-blocks
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
