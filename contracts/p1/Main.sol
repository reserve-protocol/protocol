// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/interfaces/IMain.sol";
import "contracts/mixins/ComponentRegistry.sol";
import "contracts/mixins/Auth.sol";
import "contracts/mixins/Versioned.sol";

/**
 * @title Main
 * @notice The center of the system around which Components orbit.
 */
// solhint-disable max-states-count
contract MainP1 is Versioned, Initializable, Auth, ComponentRegistry, UUPSUpgradeable, IMain {
    IERC20 public rsr;

    /// @custom:oz-upgrades-unsafe-allow constructor
    // solhint-disable-next-line no-empty-blocks
    constructor() initializer {}

    /// Initializer
    function init(
        Components memory components,
        IERC20 rsr_,
        uint48 shortFreeze_,
        uint48 longFreeze_
    ) public virtual initializer {
        require(address(rsr_) != address(0), "invalid RSR address");
        __Auth_init(shortFreeze_, longFreeze_);
        __ComponentRegistry_init(components);
        __UUPSUpgradeable_init();

        rsr = rsr_;
        emit MainInitialized();
    }

    /// @custom:refresher
    /// @custom:interaction CEI
    function poke() external {
        // == Refresher ==
        assetRegistry.refresh();

        // == CE block ==
        require(!pausedOrFrozen(), "paused or frozen");
        furnace.melt();
        stRSR.payoutRewards();
    }

    function hasRole(bytes32 role, address account)
        public
        view
        override(IAccessControlUpgradeable, AccessControlUpgradeable)
        returns (bool)
    {
        return super.hasRole(role, account);
    }

    // === Upgradeability ===
    // solhint-disable-next-line no-empty-blocks
    function _authorizeUpgrade(address newImplementation) internal override onlyRole(OWNER) {}

    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
     */
    uint256[49] private __gap;
}
