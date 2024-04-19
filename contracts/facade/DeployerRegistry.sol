// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";
import "../interfaces/IDeployerRegistry.sol";

/**
 * @title DeployerRegistry
 * @notice A tiny contract for tracking deployments over time, from an EOA.
 * @dev Does not allow overwriting without deregistration
 */
contract DeployerRegistry is IDeployerRegistry, Ownable {
    string public constant ENS = "reserveprotocol.eth";

    mapping(string => IDeployer) public deployments;

    IDeployer public override latestDeployment;

    constructor(address owner_) Ownable() {
        _transferOwnership(owner_);
    }

    /// Register a deployer address, keyed by a version.
    /// @dev Does not allow overwriting without deregistration
    /// @param version A semver version string
    /// @param makeLatest True iff this deployment should be promoted to be the latest deployment
    function register(
        string calldata version,
        IDeployer deployer,
        bool makeLatest
    ) external onlyOwner {
        require(address(deployer) != address(0), "deployer is zero addr");
        require(address(deployments[version]) == address(0), "cannot overwrite");

        emit DeploymentRegistered(version, deployer);

        deployments[version] = deployer;

        if (makeLatest) {
            emit LatestChanged(version, deployer);
            latestDeployment = deployer;
        }
    }

    /// Unregister by version
    function unregister(string calldata version) external onlyOwner {
        emit DeploymentUnregistered(version, deployments[version]);
        if (latestDeployment == deployments[version]) latestDeployment = IDeployer(address(0));
        deployments[version] = IDeployer(address(0));
    }
}
