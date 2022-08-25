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
    string mandate;
    // === Deployer params ===
    DeploymentParams params;
}

/**
 * @title SetupParams
 * @notice The set of protocol params needed to setup a full instance of an RToken
 */
struct SetupParams {
    // ===  Assets  ===
    IAsset[] assets;
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
 * @title GovernanceParams
 * @notice The set of params required to setup decentralized governance
 */
struct GovernanceParams {
    uint256 votingDelay; // in blocks
    uint256 votingPeriod; // in blocks
    uint256 proposalThresholdAsMicroPercent; // e.g. 1e4 for 0.01%
    uint256 quorumPercent; // e.g 4 for 4%
    uint256 timelockDelay; // in seconds (used for timelock)
}

/**
 * @title IFacadeWrite
 * @notice A UX-friendly layer for interactin with the protocol
 */
interface IFacadeWrite {
    /// Emitted when a new Governance is deployed
    /// @param rToken The address of the RToken
    /// @param governance The address of the new governance
    /// @param timelock The address of the timelock
    event GovernanceCreated(
        IRToken indexed rToken,
        address indexed governance,
        address indexed timelock
    );

    /// Deploys an instance of an RToken
    function deployRToken(ConfigurationParams calldata config, SetupParams calldata setup)
        external
        returns (address);

    /// Sets up governance for an RToken
    function setupGovernance(
        IRToken rToken,
        bool deployGovernance,
        bool unfreeze,
        GovernanceParams calldata govParams,
        address owner,
        address guardian,
        address pauser
    ) external returns (address);
}
