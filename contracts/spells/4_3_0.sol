// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.28;

import "../interfaces/IDeployer.sol";
import "../mixins/Versioned.sol";
import "../p1/Main.sol";

bytes32 constant MAIN_OWNER_ROLE = bytes32("OWNER");

/**
 * The upgrade spell for the 4.3.0 release. Upgrading RToken must be on 4.2.0.
 *
 * Supported RTokens:
 *   Mainnet:
 *    - eUSD
 *    - ETH+
 *    - USD3
 *   Base:
 *    - bsdETH
 *
 * The spell can only be cast once per RToken.
 *
 * Before casting the spell:
 *   - the 4.3.0 deployer must be registered in the VersionRegistry
 *   - all currently registered assets must be valid for 4.3.0 in the AssetPluginRegistry;
 *     deprecated assets must be unregistered first
 *   - this contract must have MAIN_OWNER_ROLE of Main
 *
 * MAIN_OWNER_ROLE is automatically renounced after casting. Governance is unchanged.
 *
 * The spell() function should be called by the timelock owning Main.
 *
 */
contract Upgrade4_3_0 is Versioned {
    error Err(uint256 index);

    bytes32 public constant PRIOR_VERSION_HASH = keccak256(abi.encodePacked("4.2.0"));
    bytes32 public constant NEW_VERSION_HASH = keccak256(abi.encodePacked("4.3.0"));

    // =======================================================================================

    IDeployer.Registries public registries;

    IDeployer public deployer;

    // RToken => bool
    mapping(IRToken => bool) public supported;

    bool public mainnet; // !mainnet | base

    // =======================================================================================

    constructor(bool _mainnet) {
        // we have to pass-in `_mainnet` because chainid is not reliable during testing
        require(block.chainid == 1 || block.chainid == 31337 || block.chainid == 8453, Err(0));
        mainnet = _mainnet;

        if (_mainnet) {
            // DAO registries (mainnet)
            registries = IDeployer.Registries(
                VersionRegistry(0xB031D7742367B92CcBEd0653B9a6341EFa47dd04),
                AssetPluginRegistry(0x15A9e0CF2Fd9842B99E015E05073b5F0f58A1C29),
                DAOFeeRegistry(0xec716deD4eABa060937D1a915F166E237039342B),
                ITrustedFillerRegistry(0x279ccF56441fC74f1aAC39E7faC165Dec5A88B3A)
            );

            // Setup `supported`
            supported[IRToken(0xA0d69E286B938e21CBf7E51D71F6A4c8918f482F)] = true; // eUSD
            supported[IRToken(0xE72B141DF173b999AE7c1aDcbF60Cc9833Ce56a8)] = true; // ETH+
            supported[IRToken(0x0d86883FAf4FfD7aEb116390af37746F45b6f378)] = true; // USD3
        } else {
            // DAO registries (base)
            registries = IDeployer.Registries(
                VersionRegistry(0xbD769ea5E93A4B232Cee08ED4C2a67Ff5Ba692Df),
                AssetPluginRegistry(0x093c07787920eB34A0A0c7a09823510725Aee4Af),
                DAOFeeRegistry(0x3513D2c7D2F51c678889CeC083E7D7Ae27b219aD),
                ITrustedFillerRegistry(0x72DB5f49D0599C314E2f2FEDf6Fe33E1bA6C7A18)
            );

            // Setup `supported`
            supported[IRToken(0xCb327b99fF831bF8223cCEd12B1338FF3aA322Ff)] = true; // bsdETH
        }

        // 4.3.0 deployer, pinned from the VersionRegistry
        deployer = registries.versionRegistry.deployments(NEW_VERSION_HASH);
        require(address(deployer) != address(0), Err(1));
        require(keccak256(abi.encodePacked(deployer.version())) == NEW_VERSION_HASH, Err(1));
    }

    // Cast once-per-rToken. Caller MUST be the timelock owning Main.
    /// @dev Requirement: this contract has admin of RToken via MAIN_OWNER_ROLE
    /// @param rToken The RToken to upgrade
    function castSpell(IRToken rToken) external {
        require(keccak256(abi.encodePacked(rToken.version())) == PRIOR_VERSION_HASH, Err(2));

        // Can only be cast once per supported RToken
        require(supported[rToken], Err(3));
        supported[rToken] = false;

        // validate caller is timelock
        MainP1 main = MainP1(address(rToken.main()));
        require(
            main.hasRole(MAIN_OWNER_ROLE, msg.sender) && // security crux
                main.hasRole(MAIN_OWNER_ROLE, address(this)),
            Err(3)
        );

        // Registries should already be set to the DAO registries
        require(
            main.versionRegistry() == registries.versionRegistry &&
                main.assetPluginRegistry() == registries.assetPluginRegistry &&
                main.daoFeeRegistry() == registries.daoFeeRegistry,
            Err(4)
        );

        // 4.3.0 should not have been deprecated since construction
        require(!registries.versionRegistry.isDeprecated(NEW_VERSION_HASH), Err(5));

        Components memory proxy = Components({
            assetRegistry: main.assetRegistry(),
            basketHandler: main.basketHandler(),
            backingManager: main.backingManager(),
            broker: main.broker(),
            distributor: main.distributor(),
            furnace: main.furnace(),
            rToken: rToken,
            rTokenTrader: main.rTokenTrader(),
            rsrTrader: main.rsrTrader(),
            stRSR: main.stRSR()
        });

        // No ongoing trades
        require(
            proxy.backingManager.tradesOpen() == 0 &&
                proxy.rTokenTrader.tradesOpen() == 0 &&
                proxy.rsrTrader.tradesOpen() == 0,
            Err(6)
        );

        // Main + Component upgrades
        {
            // Upgrade Main
            main.upgradeMainTo(NEW_VERSION_HASH);
            require(keccak256(abi.encodePacked(main.version())) == NEW_VERSION_HASH, Err(7));

            // Upgrade components, validating all assets are supported for 4.3.0 afterwards
            main.upgradeRTokenTo(NEW_VERSION_HASH, false, true);

            // Verify all components are upgraded
            require(
                keccak256(abi.encodePacked(proxy.assetRegistry.version())) == NEW_VERSION_HASH &&
                    keccak256(abi.encodePacked(proxy.basketHandler.version())) ==
                    NEW_VERSION_HASH &&
                    keccak256(abi.encodePacked(proxy.backingManager.version())) ==
                    NEW_VERSION_HASH &&
                    keccak256(abi.encodePacked(proxy.broker.version())) == NEW_VERSION_HASH &&
                    keccak256(abi.encodePacked(proxy.distributor.version())) == NEW_VERSION_HASH &&
                    keccak256(abi.encodePacked(proxy.furnace.version())) == NEW_VERSION_HASH &&
                    keccak256(abi.encodePacked(proxy.rToken.version())) == NEW_VERSION_HASH &&
                    keccak256(abi.encodePacked(proxy.rTokenTrader.version())) == NEW_VERSION_HASH &&
                    keccak256(abi.encodePacked(proxy.rsrTrader.version())) == NEW_VERSION_HASH &&
                    keccak256(abi.encodePacked(proxy.stRSR.version())) == NEW_VERSION_HASH,
                Err(8)
            );

            // Verify trading plugins are updated
            Implementations memory impls = deployer.implementations();
            require(
                address(TestIBroker(address(proxy.broker)).dutchTradeImplementation()) ==
                    address(impls.trading.dutchTrade) &&
                    address(TestIBroker(address(proxy.broker)).batchTradeImplementation()) ==
                    address(impls.trading.gnosisTrade),
                Err(9)
            );
        }

        // Basket checks
        {
            // New storage slot should start unset: the trading delay applies to the current basket
            require(!proxy.basketHandler.tradingDelayBypassed(), Err(10));

            proxy.assetRegistry.refresh();
            require(proxy.basketHandler.status() == CollateralStatus.SOUND, Err(11));
        }

        // Renounce adminship and validate final state
        {
            main.renounceRole(MAIN_OWNER_ROLE, address(this));

            require(
                main.hasRole(MAIN_OWNER_ROLE, msg.sender) &&
                    !main.hasRole(MAIN_OWNER_ROLE, address(this)) &&
                    !main.hasRole(MAIN_OWNER_ROLE, address(main)),
                Err(12)
            );
        }
    }
}
