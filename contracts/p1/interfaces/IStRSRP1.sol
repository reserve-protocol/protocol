// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/*
 * @title IStRSRP1
 * @notice A rebasing token that represents claims on staked RSR and entitles the AssetManager to seize RSR.
 */
interface IStRSRP1 is IERC20 {
    /// Emitted when RSR is staked
    /// @param staker The address of the staker
    /// @param amount {qRSR} The quantity of RSR staked
    event Staked(address indexed staker, uint256 indexed amount);
    /// Emitted when an unstaking is started
    /// @param withdrawalId The id of the withdrawal, globally unique
    /// @param staker The address of the unstaker
    /// @param amount {qRSR} The quantity of RSR being unstaked
    /// @param availableAt {sec} The timestamp at which the staking is eligible to be completed
    event UnstakingStarted(
        uint256 indexed withdrawalId,
        address indexed staker,
        uint256 indexed amount,
        uint256 availableAt
    );
    /// Emitted when RSR is unstaked
    /// @param withdrawalId The id of the withdrawal, globally unique
    /// @param staker The address of the unstaker
    /// @param amount {qRSR} The quantity of RSR unstaked
    event UnstakingCompleted(uint256 indexed withdrawalId, address indexed staker, uint256 indexed amount);
    /// Emitted when dividend RSR is added to the pool
    /// @param from The address that sent the dividend RSR
    /// @param amount {qRSR} The quantity of RSR added
    event RSRAdded(address indexed from, uint256 indexed amount);
    /// Emitted when insurance RSR is seized from the pool
    /// @param from The address that seized the staked RSR (should only be the AssetManager)
    /// @param amount {qRSR} The quantity of RSR seized
    event RSRSeized(address indexed from, uint256 indexed amount);

    //

    /// Stakes an RSR `amount` on the corresponding RToken to earn yield and insure the system
    /// @param amount {qRSR}
    function stake(uint256 amount) external;

    /// Begins a delayed unstaking for `amount` stRSR
    /// @param amount {qRSR}
    function unstake(uint256 amount) external;

    /// @param amount {qRSR}
    function addRSR(uint256 amount) external;

    /// AssetManager only
    /// @param amount {qRSR}
    function seizeRSR(uint256 amount) external;
}
