// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import { IDeployer, Implementations } from "../interfaces/IDeployer.sol";
import { RoleRegistry } from "./RoleRegistry.sol";

/**
 * @title VersionRegistry
 * @notice A tiny contract for tracking deployment versions
 *         All versions registered are expected to include veRSR, so effectively 4.0.0+.
 */
contract VersionRegistry {
    mapping(bytes32 => IDeployer) public deployments;
    mapping(bytes32 => bool) public isDeprecated;
    bytes32 private latestVersion;
    RoleRegistry public roleRegistry;

    error VersionRegistry__ZeroAddress();
    error VersionRegistry__InvalidRegistration();
    error VersionRegistry__AlreadyDeprecated();
    error VersionRegistry__InvalidRoleRegistry();
    error VersionRegistry__InvalidCaller();

    event VersionRegistered(bytes32 versionHash, IDeployer deployer);
    event VersionDeprecated(bytes32 versionHash);

    constructor(RoleRegistry _roleRegistry) {
        if (address(_roleRegistry) == address(0)) {
            revert VersionRegistry__ZeroAddress();
        }

        roleRegistry = _roleRegistry;
    }

    /// Register a deployer address, keyed by version.
    /// @param deployer The deployer contract address for the version to be added.
    function registerVersion(IDeployer deployer) external {
        if (!roleRegistry.isOwner(msg.sender)) {
            revert VersionRegistry__InvalidCaller();
        }

        if (address(deployer) == address(0)) {
            revert VersionRegistry__ZeroAddress();
        }

        string memory version = deployer.version();
        bytes32 versionHash = keccak256(abi.encodePacked(version));

        if (address(deployments[versionHash]) != address(0)) {
            revert VersionRegistry__InvalidRegistration();
        }

        deployments[versionHash] = deployer;
        latestVersion = versionHash;

        emit VersionRegistered(versionHash, deployer);
    }

    function deprecateVersion(bytes32 versionHash) external {
        if (!roleRegistry.isOwnerOrEmergencyCouncil(msg.sender)) {
            revert VersionRegistry__InvalidCaller();
        }

        if (isDeprecated[versionHash]) {
            revert VersionRegistry__AlreadyDeprecated();
        }
        isDeprecated[versionHash] = true;

        emit VersionDeprecated(versionHash);
    }

    function getLatestVersion()
        external
        view
        returns (
            bytes32 versionHash,
            string memory version,
            IDeployer deployer,
            bool deprecated
        )
    {
        versionHash = latestVersion;
        deployer = deployments[versionHash];
        version = deployer.version();
        deprecated = isDeprecated[versionHash];
    }

    function getImplementationForVersion(bytes32 versionHash)
        external
        view
        returns (Implementations memory)
    {
        return deployments[versionHash].implementations();
    }
}
