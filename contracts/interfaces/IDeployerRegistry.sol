// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "./IDeployer.sol";

interface IDeployerRegistry {
    event DeploymentUnregistered(string version, IDeployer deployer);
    event DeploymentRegistered(string version, IDeployer deployer);
    event LatestChanged(string version, IDeployer deployer);

    /// Register a deployer address, keyed by a version.
    /// @dev Does not allow overwriting without deregistration
    /// @param version A semver version string
    /// @param makeLatest True iff this deployment should be promoted to be the latest deployment
    function register(
        string calldata version,
        IDeployer deployer,
        bool makeLatest
    ) external;

    /// Unregister by version
    function unregister(string calldata version) external;

    /// @return The Deployer from the latest deployment
    function latestDeployment() external view returns (IDeployer);
}
