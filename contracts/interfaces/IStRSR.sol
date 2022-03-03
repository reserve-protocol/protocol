// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;
import "@openzeppelin/contracts/token/ERC20/extensions/draft-IERC20Permit.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/libraries/Fixed.sol";
import "./IComponent.sol";
import "./IMain.sol";

/*
 * @title IStRSR
 * A token representing shares of the staked RSR pool. The AssetManager is entitled
 * to seize that staked RSR when needed.
 * @dev The p0-specific IStRSR
 */
interface IStRSR is IERC20Permit, IERC20, IComponent {
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
    /// @param draftId The id of the draft. (staker, draftId) are pairwise unique.
    /// @param staker The address of the unstaker
    /// @param rsrAmount {qRSR} How much RSR this unstaking will be worth, absent seizures
    /// @param stRSRAmount {qStRSR} How much stRSR was burned by this unstaking
    event UnstakingStarted(
        uint256 indexed draftId,
        address indexed staker,
        uint256 indexed rsrAmount,
        uint256 stRSRAmount
    );

    /// Emitted when RSR is unstaked
    /// @param firstId The first draft ID withdrawn in this transaction
    /// @param lastId The last draft ID withdrawn in this transaction
    /// @param staker The address of the unstaker
    /// @param rsrAmount {qRSR} How much RSR this unstaking was worth
    event UnstakingCompleted(
        uint256 indexed firstId,
        uint256 indexed lastId,
        address indexed staker,
        uint256 rsrAmount
    );

    /// Emitted when dividend RSR is applied to the staking pool
    /// @param amount {qRSR} The amount of RSR rewarded to the staking pool
    /// @param numPeriods How many reward periods were paid out at once
    event RSRRewarded(uint256 indexed amount, uint256 indexed numPeriods);

    /// Emitted when insurance RSR is seized from the pool
    /// @param from The address that seized the staked RSR (should only be the AssetManager)
    /// @param amount {qRSR} The quantity of RSR seized
    event RSRSeized(address indexed from, uint256 indexed amount);

    /// Emitted if all the RSR in the staking pool is seized and all balances are reset to zero.
    event AllBalancesReset();

    event UnstakingDelaySet(uint256 indexed oldVal, uint256 indexed newVal);
    event RewardPeriodSet(uint256 indexed oldVal, uint256 indexed newVal);
    event RewardRatioSet(Fix indexed oldVal, Fix indexed newVal);

    /// Stakes an RSR `amount` on the corresponding RToken to earn yield and insure the system
    /// @param amount {qRSR}
    function stake(uint256 amount) external;

    /// Begins a delayed unstaking for `amount` stRSR
    /// @param amount {qRSR}
    function unstake(uint256 amount) external;

    /// @return seizedRSR {qRSR} The actual amount seized. May be dust-larger than `amount`.
    function seizeRSR(uint256 amount) external returns (uint256 seizedRSR);

    /// Gather and payout rewards from rsrTrader. State Keeper.
    function payoutRewards() external;

    /// Sets Main, only by owner
    function setMain(IMain main) external;
}
