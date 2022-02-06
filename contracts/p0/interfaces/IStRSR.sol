// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;
import "@openzeppelin/contracts/token/ERC20/extensions/draft-IERC20Permit.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./IMain.sol";

/*
 * @title IStRSR
 * A token representing shares of the staked RSR pool. The AssetManager is entitled
 * to seize that staked RSR when needed.
 */
interface IStRSR is IERC20, IERC20Permit {
    /// Emitted when Main is set
    /// @param oldMain The old address of Main
    /// @param newMain The new address of Main
    event MainSet(IMain indexed oldMain, IMain indexed newMain);

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
    event UnstakingCompleted(
        uint256 indexed withdrawalId,
        address indexed staker,
        uint256 indexed amount
    );

    /// Process all vested withdrawals, callable by anyone
    /// @return Whether it was successful
    function tryProcessWithdrawals() external returns (bool);

    /// Stake an amount of RSR to insure the RToken
    /// @param amount {qRSR}
    function stake(uint256 amount) external;

    /// Initiate a delayed unstaking
    /// @param amount {qRSR}
    function unstake(uint256 amount) external;

    /// Seize an amount of RSR, callable only by Main
    /// @param amount {qRSR}
    function seizeRSR(uint256 amount) external;

    /// Set Main, callable only by owner
    function setMain(IMain main) external;
}
