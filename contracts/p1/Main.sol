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

    /**
     * @dev Upgrading from a prior version to 4.0.0, this must happen in the Governance proposal.
     */
    function upgradeMainTo(bytes32 versionHash) external onlyRole(OWNER) {
        require(address(versionRegistry) != address(0), "no registry");

        Implementations memory implementation = versionRegistry.getImplementationForVersion(
            versionHash
        );

        this.upgradeTo(address(implementation.main));
    }

    function upgradeRTokenTo(bytes32 versionHash) external onlyRole(OWNER) {
        require(address(versionRegistry) != address(0), "no registry");
        require(keccak256(abi.encodePacked(this.version())) == versionHash, "upgrade main first");

        Implementations memory implementation = versionRegistry.getImplementationForVersion(
            versionHash
        );

        _upgradeProxy(address(rToken), address(implementation.components.rToken));
        _upgradeProxy(address(stRSR), address(implementation.components.stRSR));
        _upgradeProxy(address(assetRegistry), address(implementation.components.assetRegistry));
        _upgradeProxy(address(basketHandler), address(implementation.components.basketHandler));
        _upgradeProxy(address(backingManager), address(implementation.components.backingManager));
        _upgradeProxy(address(distributor), address(implementation.components.distributor));
        _upgradeProxy(address(furnace), address(implementation.components.furnace));
        _upgradeProxy(address(broker), address(implementation.components.broker));
        _upgradeProxy(address(rsrTrader), address(implementation.components.rsrTrader));
        _upgradeProxy(address(rTokenTrader), address(implementation.components.rTokenTrader));

        broker.setBatchTradeImplementation(implementation.trading.gnosisTrade);
        broker.setDutchTradeImplementation(implementation.trading.dutchTrade);
    }

    // === Upgradeability ===
    // solhint-disable-next-line no-empty-blocks
    function _authorizeUpgrade(address newImplementation) internal override onlyRole(OWNER) {}

    function _upgradeProxy(address proxy, address implementation) internal {
        (bool success, ) = proxy.call(
            abi.encodeWithSelector(UUPSUpgradeable.upgradeTo.selector, implementation)
        );
        require(success, "upgrade failed");
    }

    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
     */
    uint256[48] private __gap;
}
