// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "./IDeployer.sol";

/**
 * @title ConfigurationParams
 * @notice The set of protocol params needed to deploy an RToken
 */
struct ConfigurationParams {
    // === RToken info ===
    string name;
    string symbol;
    string manifestoURI;
    // === Deployer params ===
    DeploymentParams params;
}

/**
 * @title SetupParams
 * @notice The set of protocol params needed to setup a full instance of an RToken
 */
struct SetupParams {
    // === Reward Assets  ===
    IAsset[] rewardAssets;
    // === Basket  ===
    ICollateral[] primaryBasket;
    uint192[] weights;
    // === Basket Backup ===
    BackupInfo[] backups;
}

/**
 * @title BackupInfo
 * @notice The set of params to define a basket backup
 */
struct BackupInfo {
    bytes32 backupUnit;
    uint256 diversityFactor;
    ICollateral[] backupCollateral;
}

/**
 * @title IFacadeWrite
 * @notice A UX-friendly layer for interactin with the protocol
 */
interface IFacadeWrite {
    /// Deploys a full instance of an RToken
    function deployRToken(
        ConfigurationParams calldata config,
        SetupParams calldata setup,
        address owner
    ) external returns (address);
}
