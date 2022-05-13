// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/p1/mixins/Lockable.sol";
import "contracts/interfaces/IMain.sol";
import "contracts/mixins/ComponentRegistry.sol";
import "contracts/mixins/Pausable.sol";

/**
 * @title Main
 * @notice The center of the system around which Components orbit.
 */
// solhint-disable max-states-count
contract MainP1 is
    Initializable,
    OwnableUpgradeable,
    ComponentRegistry,
    Pausable,
    Lockable,
    UUPSUpgradeable,
    IMain
{
    IERC20 public rsr;

    /// @custom:oz-upgrades-unsafe-allow constructor
    // solhint-disable-next-line no-empty-blocks
    constructor() initializer {}

    /// Initializer
    function init(
        Components memory components,
        IERC20 rsr_,
        uint32 oneshotPauseDuration_
    ) public virtual initializer {
        __Pausable_init(oneshotPauseDuration_);
        __ComponentRegistry_init(components);
        __Lockable_init();
        __UUPSUpgradeable_init();

        rsr = rsr_;

        emit MainInitialized();
    }

    /// @custom:action
    function poke() external {
        assetRegistry.forceUpdates();
        furnace.melt();
        stRSR.payoutRewards();
    }

    // solhint-disable
    function poke_sub() external {}

    // solhint-enable

    function owner() public view override(IMain, OwnableUpgradeable) returns (address) {
        return OwnableUpgradeable.owner();
    }

    // === See docs/security.md ===

    function beginActionTx() external virtual {
        require(isComponent(_msgSender()), "caller is not a component");
        require(!paused(), "paused");
        _lock();
    }

    function beginGovernanceTx(address prevCaller) external virtual {
        require(isComponent(_msgSender()), "caller is not a component");
        require(OwnableUpgradeable.owner() == prevCaller, "prev caller is not the owner");
        _lock();
    }

    function beginSubroutine(address prevCaller) external virtual {
        require(isComponent(prevCaller), "tx caller is not a component");
        // TODO do we need to require a lock is open here? one downside is it would make it harder
        //  to execute subroutines from tests where we impersonate a component
    }

    function endTx() external virtual {
        _unlock(); // ensures the caller is the original lock-er
    }

    // === Upgradeability ===
    // solhint-disable-next-line no-empty-blocks
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
