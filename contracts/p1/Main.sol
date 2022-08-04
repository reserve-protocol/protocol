// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/interfaces/IMain.sol";
import "contracts/mixins/ComponentRegistry.sol";
import "contracts/mixins/Auth.sol";

/**
 * @title Main
 * @notice The center of the system around which Components orbit.
 */
// solhint-disable max-states-count
contract MainP1 is
    Initializable,
    Auth,
    ComponentRegistry,
    ReentrancyGuardUpgradeable,
    UUPSUpgradeable,
    IMain
{
    IERC20 public rsr;

    /// Immutable: expected to be an IPFS link but could be anything
    string public manifestoURI;

    /// @custom:oz-upgrades-unsafe-allow constructor
    // solhint-disable-next-line no-empty-blocks
    constructor() initializer {}

    /// Initializer
    function init(
        Components memory components,
        IERC20 rsr_,
        string memory manifestoURI_,
        uint32 freezeDuration_
    ) public virtual initializer {
        __Auth_init(freezeDuration_);
        __ComponentRegistry_init(components);
        __UUPSUpgradeable_init();

        rsr = rsr_;
        manifestoURI = manifestoURI_;
        emit MainInitialized();
    }

    /// @custom:refresher
    /// @custom:interaction CEI
    function poke() external {
        require(!pausedOrFrozen(), "paused or frozen");
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
}
