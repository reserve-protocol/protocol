// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { IDeployer, Implementations } from "../interfaces/IDeployer.sol";

/**
 * @title VersionRegistry
 * @notice A tiny contract for tracking deployments over time, from an EOA.
 * @dev Does not allow overwriting without deregistration
 */
contract VersionRegistry is Ownable {
    mapping(bytes32 => IDeployer) public deployments;
    bytes32 private latestVersion;

    error VersionRegistry__ZeroAddress();
    error VersionRegistry__InvalidRegistration();

    constructor(address owner_) Ownable() {
        _transferOwnership(owner_);
    }

    /// Register a deployer address, keyed by version.
    /// @param deployer The deployer contract address for the version to be added.
    function registerVersion(IDeployer deployer) external onlyOwner {
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
    }

    function getLatestVersion()
        external
        view
        returns (
            bytes32 versionHash,
            string memory version,
            IDeployer deployer
        )
    {
        versionHash = latestVersion;
        deployer = deployments[versionHash];
        version = deployer.version();
    }

    function getImplementationForVersion(bytes32 versionHash)
        external
        view
        returns (Implementations memory)
    {
        return deployments[versionHash].implementations();
    }
}
