// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/IERC20MetadataUpgradeable.sol";
// solhint-disable-next-line max-line-length
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/draft-IERC20PermitUpgradeable.sol";
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
interface IStRSR is IERC20PermitUpgradeable, IERC20MetadataUpgradeable, IComponent {
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

    /// Emitted whenever the exchange rate changes
    event ExchangeRateSet(int192 indexed oldVal, int192 indexed newVal);

    /// Emitted if all the RSR in the staking pool is seized and all balances are reset to zero.
    event AllBalancesReset(uint256 indexed newEra);

    event UnstakingDelaySet(uint32 indexed oldVal, uint32 indexed newVal);
    event RewardPeriodSet(uint32 indexed oldVal, uint32 indexed newVal);
    event RewardRatioSet(int192 indexed oldVal, int192 indexed newVal);

    // Initialization
    function init(
        IMain main_,
        string memory name_,
        string memory symbol_,
        uint32 unstakingDelay_,
        uint32 rewardPeriod_,
        int192 rewardRatio_
    ) external;

    /// Stakes an RSR `amount` on the corresponding RToken to earn yield and insure the system
    /// @param amount {qRSR}
    /// @custom:action
    function stake(uint256 amount) external;

    /// Begins a delayed unstaking for `amount` stRSR
    /// @param amount {qStRSR}
    /// @custom:action
    function unstake(uint256 amount) external;

    /// Complete delayed unstaking for the account, up to (but not including!) `endId`.
    /// @custom:completion
    function withdraw(address account, uint256 endId) external;

    /// Return the maximum valid value of endId such that withdraw(endId) should immediately work
    function endIdForWithdraw(address account) external view returns (uint256 endId);

    /// Seize RSR, only callable by main.backingManager()
    function seizeRSR(uint256 amount) external;

    /// Gather and payout rewards from rsrTrader. State Keeper.
    /// @custom:refresher
    function payoutRewards() external;

    /// @return {qStRSR/qRSR} The exchange rate between StRSR and RSR
    function exchangeRate() external view returns (int192);
}

interface TestIStRSR is IStRSR {
    function rewardPeriod() external view returns (uint32);

    function setRewardPeriod(uint32) external;

    function rewardRatio() external view returns (int192);

    function setRewardRatio(int192) external;

    function unstakingDelay() external view returns (uint32);

    function setUnstakingDelay(uint32) external;

    function increaseAllowance(address, uint256) external returns (bool);

    function decreaseAllowance(address, uint256) external returns (bool);
}
