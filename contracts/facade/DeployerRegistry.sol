// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/access/Ownable.sol";
import "contracts/interfaces/IDeployerRegistry.sol";

/**
 * @title DeployerRegistry
 * @notice A tiny contract for tracking deployments over time, from an EOA.
 */
contract DeployerRegistry is IDeployerRegistry, Ownable {
    string public constant ENS = "reserveprotocol.eth";

    mapping(string => IDeployer) public deployments;

    IDeployer public override latestDeployment;

    /// Register a deployer address, keyed by a version.
    /// @param version A semver version string
    /// @param replace True iff there is already a registered deployment at this version
    /// @param makeLatest True iff this deployment should be promoted to be the latest deployment
    function register(
        string calldata version,
        IDeployer deployer,
        bool replace,
        bool makeLatest
    ) external onlyOwner {
        if (replace) {
            require(address(deployments[version]) != address(0), "not replacing");
            emit DeploymentUnregistered(version, deployments[version]);
        } else {
            require(address(deployments[version]) == address(0), "need replace");

            // If we aren't replacing, then a zero-address deployer is likely a mistake
            require(address(deployer) != address(0), "deployer is zero addr");
        }

        emit DeploymentRegistered(version, deployer);

        deployments[version] = deployer;

        if (makeLatest) {
            latestDeployment = deployer;
        }
    }
}
