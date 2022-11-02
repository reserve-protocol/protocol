// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "./IDeployer.sol";

interface IDeployerRegistry {
    event DeploymentUnregistered(string version, IDeployer deployer);
    event DeploymentRegistered(string version, IDeployer deployer);

    /// Register a deployer address, keyed by a version.
    /// @param version A semver version string
    /// @param replace True iff there is already a registered deployment at this version
    /// @param makeLatest True iff this deployment should be promoted to be the latest deployment
    function register(
        string calldata version,
        IDeployer deployer,
        bool replace,
        bool makeLatest
    ) external;

    /// @return The Deployer from the latest deployment
    function latestDeployment() external view returns (IDeployer);
}
