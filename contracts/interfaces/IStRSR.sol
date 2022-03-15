// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;
import "@openzeppelin/contracts/token/ERC20/extensions/draft-IERC20Permit.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/libraries/Fixed.sol";
import "./IComponent.sol";
import "./IMain.sol";

/**
 * @title IStRSR
 * @notice An ERC20 token representing shares of the RSR insurance pool.
 *
 * StRSR permits the BackingManager to take RSR in times of need. In return, the BackingManager
 * benefits the StRSR pool with RSR rewards purchased with a portion of its revenue.
 *
 * In the absence of collateral default or losses due to slippage, StRSR should have a
 * monotonically increasing exchange rate with respect to RSR, meaning that over time
 * StRSR is redeemable for more RSR. It is non-rebasing.
 */
interface IStRSR is IERC20Permit, IERC20, IComponent {
    /// Emitted when RSR is staked
    /// @param staker The address of the staker
    /// @param rsrAmount {qRSR} How much RSR was staked
    /// @param stRSRAmount {qStRSR} How much stRSR was minted by this staking
    event Staked(address indexed staker, uint256 indexed rsrAmount, uint256 indexed stRSRAmount);

    /// Emitted when an unstaking is started
    /// @param draftId The id of the draft.
    /// @param draftEra The era of the draft.
    /// @param staker The address of the unstaker
    ///   The triple (staker, draftEra, draftId) is a unique ID
    /// @param rsrAmount {qRSR} How much RSR this unstaking will be worth, absent seizures
    /// @param stRSRAmount {qStRSR} How much stRSR was burned by this unstaking
    event UnstakingStarted(
        uint256 indexed draftId,
        uint256 indexed draftEra,
        address indexed staker,
        uint256 rsrAmount,
        uint256 stRSRAmount,
        uint256 availableAt
    );

    /// Emitted when RSR is unstaked
    /// @param firstId The beginning of the range of draft IDs withdrawn in this transaction
    /// @param endId The end of range of draft IDs withdrawn in this transaction
    ///   (ID i was withdrawn if firstId <= i < endId)
    /// @param draftEra The era of the draft.
    ///   The triple (staker, draftEra, id) is a unique ID among drafts
    /// @param staker The address of the unstaker

    /// @param rsrAmount {qRSR} How much RSR this unstaking was worth
    event UnstakingCompleted(
        uint256 indexed firstId,
        uint256 indexed endId,
        uint256 draftEra,
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
    event AllBalancesReset(uint256 indexed newEra);

    event UnstakingDelaySet(uint256 indexed oldVal, uint256 indexed newVal);
    event RewardPeriodSet(uint256 indexed oldVal, uint256 indexed newVal);
    event RewardRatioSet(Fix indexed oldVal, Fix indexed newVal);

    /// Stakes an RSR `amount` on the corresponding RToken to earn yield and insure the system
    /// @param amount {qRSR}
    /// @custom:action
    function stake(uint256 amount) external;

    /// Begins a delayed unstaking for `amount` stRSR
    /// @param amount {qRSR}
    /// @custom:action
    function unstake(uint256 amount) external;

    /// Complete delayed unstaking for the account, up to (but not including!) `endId`.
    /// @custom:completion
    function withdraw(address account, uint256 endId) external;

    /// Return the maximum valid value of endId such that withdraw(endId) should immediately work
    function endIdForWithdraw(address account) external view returns (uint256 endId);

    /// @return seizedRSR {qRSR} The actual amount seized. May be dust-larger than `amount`.
    function seizeRSR(uint256 amount) external returns (uint256 seizedRSR);

    /// Gather and payout rewards from rsrTrader. State Keeper.
    /// @custom:refresher
    function payoutRewards() external;

    /// @return {qStRSR/qRSR} The exchange rate between StRSR and RSR
    function exchangeRate() external view returns (Fix);
}
