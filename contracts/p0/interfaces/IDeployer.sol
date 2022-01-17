// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "./IAsset.sol";
import "./IVault.sol";

/**
 * @title IDeployer
 * @notice The deployer for the entire system.
 */
interface IDeployer {
    /// Emitted when a new RToken and accompanying system is deployed
    /// @param main The address of `Main`
    /// @param owner The owner of the newly deployed system
    event RTokenCreated(
        address indexed main,
        address indexed rToken,
        address explorer,
        address indexed owner
    );

    //

    /// Deploys an instance of the entire system
    /// @param name The name of the RToken to deploy
    /// @param symbol The symbol of the RToken to deploy
    /// @param owner The address that should own the entire system, hopefully a governance contract
    /// @param config Governance param
    /// @param dist Shares of revenue initially to RSR pool and RToken melting
    /// @param compoundOracle A deployment of an adapter for the compound oracle
    /// @param aaveOracle A deployment of an adapter for the aave oracle
    /// @param collateral The collateral assets in the system
    /// @return The address of the newly deployed Main instance.
    function deploy(
        string calldata name,
        string calldata symbol,
        address owner,
        Config calldata config,
        RevenueShare calldata dist,
        IOracle compoundOracle,
        IOracle aaveOracle,
        ICollateral[] calldata collateral
    ) external returns (address);
}
