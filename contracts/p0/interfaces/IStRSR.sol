// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;
import "@openzeppelin/contracts/token/ERC20/extensions/draft-IERC20Permit.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/p0/interfaces/IERC20Receiver.sol";
import "./IMain.sol";

/*
 * @title IStRSR
 * A token representing shares of the staked RSR pool. The AssetManager is entitled
 * to seize that staked RSR when needed.
 * @dev The p0-specific IStRSR
 */
interface IStRSR is IERC20Receiver, IERC20Permit, IERC20 {
    /// Emitted when Main is set
    /// @param oldMain The old address of Main
    /// @param newMain The new address of Main
    event MainSet(IMain indexed oldMain, IMain indexed newMain);

    /// Emitted when RSR is staked
    /// @param staker The address of the staker
    /// @param rsrAmount {qRSR} How much RSR was staked
    /// @param stRSRAmount {qStRSR} How much stRSR was minted by this staking
    event Staked(address indexed staker, uint256 indexed rsrAmount, uint256 indexed stRSRAmount);

    /// Emitted when an unstaking is started
    /// @param withdrawalId The id of the withdrawal, globally unique
    /// @param staker The address of the unstaker
    /// @param rsrAmount {qRSR} How much RSR this unstaking will be worth, absent seizures
    /// @param stRSRAmount {qStRSR} How much stRSR was burned by this unstaking
    /// @param availableAt {sec} The timestamp at which the staking is eligible to be completed
    event UnstakingStarted(
        uint256 indexed withdrawalId,
        address indexed staker,
        uint256 indexed rsrAmount,
        uint256 indexed stRSRAmount,
        uint256 availableAt
    );

    /// Emitted when RSR is unstaked
    /// @param withdrawalId The id of the withdrawal, globally unique
    /// @param staker The address of the unstaker
    /// @param rsrAmount {qRSR} How much RSR this unstaking was worth
    event UnstakingCompleted(
        uint256 indexed withdrawalId,
        address indexed staker,
        uint256 indexed rsrAmount
    );

    /// Emitted when dividend RSR is added to the pool
    /// @param from The address that sent the dividend RSR
    /// @param amount {qRSR} The quantity of RSR added
    event RSRAdded(address indexed from, uint256 indexed amount);

    /// Emitted when insurance RSR is seized from the pool
    /// @param from The address that seized the staked RSR (should only be the AssetManager)
    /// @param amount {qRSR} The quantity of RSR seized
    event RSRSeized(address indexed from, uint256 indexed amount);

    /// Stakes an RSR `amount` on the corresponding RToken to earn yield and insure the system
    /// @param amount {qRSR}
    function stake(uint256 amount) external;

    /// Begins a delayed unstaking for `amount` stRSR
    /// @param amount {qRSR}
    function unstake(uint256 amount) external;

    /// @return seizedRSR {qRSR} The actual amount seized. May be dust-larger than `amount`.
    function seizeRSR(uint256 amount) external returns (uint256 seizedRSR);

    /// Sets Main, only by owner
    function setMain(IMain main) external;
}
