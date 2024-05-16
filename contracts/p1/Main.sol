// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../interfaces/IMain.sol";
import "../mixins/ComponentRegistry.sol";
import "../mixins/Auth.sol";
import "../mixins/Versioned.sol";
import "../registry/VersionRegistry.sol";

/**
 * @title Main
 * @notice The center of the system around which Components orbit.
 */
// solhint-disable max-states-count
contract MainP1 is Versioned, Initializable, Auth, ComponentRegistry, UUPSUpgradeable, IMain {
    IERC20 public rsr;
    VersionRegistry public versionRegistry;

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
    /// @dev Not intended to be used in production, only for equivalence with P0
    function poke() external {
        // == Refresher ==
        assetRegistry.refresh(); // runs furnace.melt()

        // == CE block ==
        stRSR.payoutRewards();
    }

    /// Set Version Registry
    /// @dev Can only be called once.
    function setVerionRegistry(VersionRegistry versionRegistry_) external onlyRole(OWNER) {
        require(address(versionRegistry_) != address(0), "invalid VersionRegistry address");
        require(address(versionRegistry) == address(0), "already set");

        versionRegistry = VersionRegistry(versionRegistry_);
    }

    function hasRole(bytes32 role, address account)
        public
        view
        override(IAccessControlUpgradeable, AccessControlUpgradeable)
        returns (bool)
    {
        return super.hasRole(role, account);
    }

    function upgradeRTokenTo(bytes32 versionHash) external onlyRole(OWNER) {
        require(address(versionRegistry) != address(0), "no VersionRegistry");

        Implementations memory implementation = versionRegistry.getImplementationForVersion(
            versionHash
        );

        // TODO: Does self upgrades work? Can we upgrade Main as a part of Main?
        // (Probably not, what if we need Main functionality for upgrades?)
        rToken.upgradeTo(address(implementation.components.rToken));
        stRSR.upgradeTo(address(implementation.components.stRSR));
        assetRegistry.upgradeTo(address(implementation.components.assetRegistry));
        basketHandler.upgradeTo(address(implementation.components.basketHandler));
        backingManager.upgradeTo(address(implementation.components.backingManager));
        distributor.upgradeTo(address(implementation.components.distributor));
        furnace.upgradeTo(address(implementation.components.furnace));
        broker.upgradeTo(address(implementation.components.broker));
        rsrTrader.upgradeTo(address(implementation.components.rsrTrader));
        rTokenTrader.upgradeTo(address(implementation.components.rTokenTrader));

        broker.setBatchTradeImplementation(implementation.trading.gnosisTrade);
        broker.setDutchTradeImplementation(implementation.trading.dutchTrade);
    }

    // === Upgradeability ===
    // solhint-disable-next-line no-empty-blocks
    function _authorizeUpgrade(address newImplementation) internal override onlyRole(OWNER) {}

    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
     */
    uint256[48] private __gap;
}
