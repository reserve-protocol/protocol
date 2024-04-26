// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts-upgradeable/interfaces/IERC1271Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/SignatureCheckerUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/draft-EIP712Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/CountersUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "../interfaces/IStRSR.sol";
import "../interfaces/IMain.sol";
import "../libraries/Fixed.sol";
import "../libraries/Permit.sol";
import "./mixins/Component.sol";

// solhint-disable max-states-count

/**
 * @title StRSRP1
 * @notice StRSR is an ERC20 token contract that allows people to stake their RSR as
 *   over-collateralization behind an RToken. As compensation stakers receive a share of revenues
 *   in the form of RSR. Balances are generally non-rebasing. As rewards are paid out StRSR becomes
 *   redeemable for increasing quantities of RSR.
 *
 * The one time that StRSR will rebase is if the entirety of over-collateralization RSR is seized.
 *   If this happens, users balances are zereod out and StRSR is re-issued at a 1:1 exchange rate
 *   with RSR.
 *
 * There's an important asymmetry in StRSR: when RSR is added it must be split only
 *   across non-withdrawing stakes, while when RSR is seized it is seized uniformly from both
 *   stakes that are in the process of being withdrawn and those that are not.
 */
abstract contract StRSRP1 is Initializable, ComponentP1, IStRSR, EIP712Upgradeable {
    using CountersUpgradeable for CountersUpgradeable.Counter;
    using SafeERC20Upgradeable for IERC20Upgradeable;

    /// @custom:oz-upgrades-unsafe-allow state-variable-immutable
    // solhint-disable-next-line var-name-mixedcase
    uint48 private constant MIN_UNSTAKING_DELAY = 60 * 2; // {s} 2 minutes
    uint48 private constant MAX_UNSTAKING_DELAY = 60 * 60 * 24 * 365; // {s} 1 year
    uint192 private constant MAX_REWARD_RATIO = 1e14; // {1} 0.01%

    // === ERC20 ===
    string public name; // immutable
    string public symbol; // immutable
    // solhint-disable const-name-snakecase
    uint8 public constant decimals = 18;

    // Component addresses, immutable after init()
    IAssetRegistry private assetRegistry;
    IBackingManager private backingManager;
    IBasketHandler private basketHandler;
    IERC20 private rsr;

    /// === Financial State: Stakes (balances) ===
    // Era. If stake balances are wiped out due to RSR seizure, increment the era to zero balances.
    // Only ever directly written by beginEra()
    uint256 internal era;

    // Typically: "balances". These are the tokenized staking positions!
    // era => ({account} => {qStRSR})
    mapping(uint256 => mapping(address => uint256)) private stakes; // Stakes per account {qStRSR}
    uint256 private totalStakes; // Total of all stakes {qStRSR}
    uint256 private stakeRSR; // Amount of RSR backing all stakes {qRSR}
    uint192 private stakeRate; // The exchange rate between stakes and RSR. D18{qStRSR/qRSR}

    uint192 private constant MAX_STAKE_RATE = 1e9 * FIX_ONE; // 1e9 D18{qStRSR/qRSR}

    // era => (owner => (spender => {qStRSR}))
    mapping(uint256 => mapping(address => mapping(address => uint256))) private _allowances;

    // === Financial State: Drafts ===
    // Era. If drafts get wiped out due to RSR seizure, increment the era to zero draft values.
    // Only ever directly written by beginDraftEra()
    uint256 internal draftEra; // {draftEra}
    // Drafts: share of the withdrawing tokens. Not transferrable and not revenue-earning.
    struct CumulativeDraft {
        // Avoid re-using uint192 in order to avoid confusion with our type system; 176 is enough
        uint176 drafts; // Total amount of drafts that will become available // {qDrafts}
        uint64 availableAt; // When the last of the drafts will become available
    }
    // {draftEra} => ({account} => {qDrafts})
    mapping(uint256 => mapping(address => CumulativeDraft[])) public draftQueues; // {qDrafts}
    mapping(uint256 => mapping(address => uint256)) public firstRemainingDraft; // draft index
    uint256 private totalDrafts; // Total of all drafts {qDrafts}
    uint256 private draftRSR; // Amount of RSR backing all drafts {qRSR}
    uint192 public draftRate; // The exchange rate between drafts and RSR. D18{qDrafts/qRSR}

    uint192 private constant MAX_DRAFT_RATE = 1e9 * FIX_ONE; // 1e9 D18{qDrafts/qRSR}

    // ==== Analysis Definitions for Financial State ====
    // Let `bal` be the map stakes[era]; so, bal[acct] == balanceOf(acct)

    // Entirely different concepts for the Drafts:
    // `draft[acct]` is a "draft record". If, say, r = draft[acct], then:
    //   Let `r.queue` be the map draftQueues[era][acct]
    //   Let `r.left` be the value firstRemainingDraft[era][acct] // ( minus 1? )
    //   Let `r.right` be the value draftsQueues[era][acct].length
    //   We further define r.queue[-1].drafts to be 0.
    //
    // So, for any keyval pair (acct, r) in draft:
    // r.left <= r.right
    // for all i and j with r.left <= i < j < r.right:
    //   r.queue[i].drafts < r.queue[j].drafts, and
    //   r.queue[i].availableAt <= r.queue[j].availableAt
    //
    // Define draftSum, the total amount of drafts eventually due to the account holder of record r:
    // Let draftSum(r:draftRecord) =
    //   r.queue[r.right-1].drafts - r.queue[r.left-1].drafts

    // ==== Invariants ====
    // [total-stakes]: totalStakes == sum(bal[acct] for acct in bal)
    // [max-stake-rate]: 0 < stakeRate <= MAX_STAKE_RATE
    // [stake-rate]: if totalStakes == 0, then stakeRSR == 0 and stakeRate == FIX_ONE
    //               else, stakeRSR * stakeRate >= totalStakes * 1e18
    //               (ie, stakeRSR covers totalStakes at stakeRate)
    //
    // [total-drafts]: totalDrafts == sum(draftSum(draft[acct]) for acct in draft)
    // [max-draft-rate]: 0 < draftRate <= MAX_DRAFT_RATE
    // [draft-rate]: if totalDrafts == 0, then draftRSR == 0 and draftRate == FIX_ONE
    //               else, draftRSR * draftRate >= totalDrafts * 1e18
    //               (ie, draftRSR covers totalDrafts at draftRate)
    //
    // === ERC20Permit ===
    mapping(address => CountersUpgradeable.Counter) private _nonces;
    // === Delegation ===
    mapping(address => CountersUpgradeable.Counter) private _delegationNonces;

    // solhint-disable-next-line var-name-mixedcase
    bytes32 private constant _PERMIT_TYPEHASH =
        keccak256(
            "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
        );

    // ==== Gov Params ====
    // Promise: Each gov param is set _only_ by the appropriate "set" function.
    uint48 public unstakingDelay; // {s} The minimum length of time spent in the draft queue
    uint192 public rewardRatio; // {1} The fraction of the revenue balance to handout per period

    // === Rewards Cache ===
    // Promise: The two *payout* vars are modified only by init() and _payoutRewards()
    //   init() pretends that the "first" payout happens at initialization time
    //   _payoutRewards() updates them as described.
    // When init() or _payoutRewards() was last called:
    //     payoutLastPaid was the timestamp when the last paid-up block ended
    //     rsrRewardsAtLastPayout was the value of rsrRewards() at that time

    // {seconds} The last time when rewards were paid out
    uint48 private payoutLastPaid;

    // {qRSR} How much reward RSR was held the last time rewards were paid out
    uint256 private rsrRewardsAtLastPayout;

    // === 3.0.0 ===
    // The fraction of draftRSR + stakeRSR that may exit without a refresh
    uint192 private constant MAX_WITHDRAWAL_LEAK = 3e17; // {1} 30%

    uint192 private leaked; // {1} stake fraction that has withdrawn without a refresh
    uint48 private lastWithdrawRefresh; // {s} timestamp of last refresh() during withdraw()
    uint192 public withdrawalLeak; // {1} gov param -- % RSR that can be withdrawn without refresh

    // stake rate under/over which governance can reset all stakes
    uint192 private constant MAX_SAFE_STAKE_RATE = 1e6 * FIX_ONE; // 1e6   D18{qStRSR/qRSR}
    uint192 private constant MIN_SAFE_STAKE_RATE = uint192(1e12); // 1e-6  D18{qStRSR/qRSR}

    // ======================

    // init() can only be called once (initializer)
    // ==== Financial State:
    // effects:
    //   draft' = {}, bal' = {}, all totals zero, all rates FIX_ONE.
    //   payoutLastPaid' = now
    //   rsrRewardsAtLastPayout' = current RSR balance ( == rsrRewards() given the above )
    function init(
        IMain main_,
        string calldata name_,
        string calldata symbol_,
        uint48 unstakingDelay_,
        uint192 rewardRatio_,
        uint192 withdrawalLeak_
    ) external initializer {
        assert(bytes(name_).length != 0);
        assert(bytes(symbol_).length != 0);
        __Component_init(main_);
        __EIP712_init(name_, VERSION);
        name = name_;
        symbol = symbol_;

        assetRegistry = main_.assetRegistry();
        backingManager = main_.backingManager();
        basketHandler = main_.basketHandler();
        rsr = IERC20(address(main_.rsr()));

        payoutLastPaid = uint48(block.timestamp);
        rsrRewardsAtLastPayout = main_.rsr().balanceOf(address(this));
        setUnstakingDelay(unstakingDelay_);
        setRewardRatio(rewardRatio_);
        setWithdrawalLeak(withdrawalLeak_);

        beginEra();
        beginDraftEra();
    }

    /// Assign reward payouts to the staker pool
    /// @custom:refresher
    function payoutRewards() external {
        _payoutRewards();
    }

    /// Stakes an RSR `amount` on the corresponding RToken to earn yield and over-collateralize
    /// the system
    /// @param rsrAmount {qRSR}
    /// @dev Staking continues while paused/frozen, with reward handouts
    /// @custom:interaction CEI
    // checks:
    //   0 < rsrAmount
    //
    // effects:
    //   stakeRSR' = stakeRSR + rsrAmount
    //   totalStakes' = stakeRSR' * stakeRate / 1e18   (as required by invariant)
    //   bal'[caller] = bal[caller] + (totalStakes' - totalStakes)
    //   stakeRate' = stakeRate     (this could go without saying, but it's important!)
    //
    // actions:
    //   rsr.transferFrom(account, this, rsrAmount)
    function stake(uint256 rsrAmount) public {
        _notZero(rsrAmount);

        _payoutRewards();

        // Mint new stakes
        address caller = _msgSender();
        mintStakes(caller, rsrAmount);

        // == Interactions ==
        IERC20Upgradeable(address(rsr)).safeTransferFrom(caller, address(this), rsrAmount);
    }

    /// Begins a delayed unstaking for `amount` StRSR
    /// @param stakeAmount {qStRSR}
    /// @custom:interaction
    // checks:
    //   not paused (trading) or frozen
    //   0 < stakeAmount <= bal[caller]
    //
    // effects:
    //   totalStakes' = totalStakes - stakeAmount
    //   bal'[caller] = bal[caller] - stakeAmount
    //   stakeRSR' = ceil(totalStakes' * 1e18 / stakeRate)
    //   stakeRate' = stakeRate (no change)
    //
    //   draftRSR' + stakeRSR' = draftRSR + stakeRSR
    //   draftRate' = draftRate (no change)
    //   totalDrafts' = floor(draftRSR' + draftRate' / 1e18)
    //
    //   A draft for (totalDrafts' - totalDrafts) drafts
    //   is freshly appended to the caller's draft record.
    function unstake(uint256 stakeAmount) external {
        _requireNotTradingPausedOrFrozen();
        _notZero(stakeAmount);

        address account = _msgSender();
        require(stakes[era][account] >= stakeAmount, "insufficient balance");

        _payoutRewards();

        // ==== Compute changes to stakes and RSR accounting
        // rsrAmount: how many RSR to move from the stake pool to the draft pool
        // pick rsrAmount as big as we can such that (newTotalStakes <= newStakeRSR * stakeRate)
        _burn(account, stakeAmount);

        // newStakeRSR: {qRSR} = D18 * {qStRSR} / D18{qStRSR/qRSR}
        uint256 newStakeRSR = (FIX_ONE_256 * totalStakes + (stakeRate - 1)) / stakeRate;
        uint256 rsrAmount = stakeRSR - newStakeRSR;
        stakeRSR = newStakeRSR;

        // Create draft
        (uint256 index, uint64 availableAt) = pushDraft(account, rsrAmount);
        emit UnstakingStarted(index, draftEra, account, rsrAmount, stakeAmount, availableAt);
    }

    /// Complete an account's unstaking; callable by anyone
    /// @custom:interaction CEIC - Warning: violates CEI; has checks at the end
    // Let:
    //   r = draft[account]
    //   draftAmount = r.queue[endId - 1].drafts - r.queue[r.left-1].drafts
    //
    // checks:
    //   RToken is fully collateralized and the basket is sound.
    //   The system is not paused (trading) or frozen.
    //   endId <= r.right
    //   r.queue[endId - 1].availableAt <= now
    //
    // effects:
    //   r'.left = max(endId, r.left)
    //   draftSum'(account) = draftSum(account) + draftAmount)
    //   r'.right = r.right
    //   totalDrafts' = totalDrafts - draftAmount
    //   draftRSR' = ceil(totalDrafts' * 1e18 / draftRate)
    //
    // actions:
    //   rsr.transfer(account, rsrOut)
    function withdraw(address account, uint256 endId) external {
        _requireNotTradingPausedOrFrozen();

        uint256 firstId = firstRemainingDraft[draftEra][account];
        CumulativeDraft[] storage queue = draftQueues[draftEra][account];
        if (endId == 0 || firstId >= endId) return;

        // == Checks + Effects ==
        require(endId <= queue.length, "index out-of-bounds");
        require(queue[endId - 1].availableAt <= block.timestamp, "withdrawal unavailable");

        // untestable:
        //      firstId will never be zero, due to previous checks against endId
        uint192 oldDrafts = firstId != 0 ? queue[firstId - 1].drafts : 0;
        uint192 draftAmount = queue[endId - 1].drafts - oldDrafts;

        // advance queue past withdrawal
        firstRemainingDraft[draftEra][account] = endId;

        // ==== Compute RSR amount
        uint256 newTotalDrafts = totalDrafts - draftAmount;
        // newDraftRSR: {qRSR} = {qDrafts} * D18 / D18{qDrafts/qRSR}
        uint256 newDraftRSR = (newTotalDrafts * FIX_ONE_256 + (draftRate - 1)) / draftRate;
        uint256 rsrAmount = draftRSR - newDraftRSR;

        if (rsrAmount == 0) return;

        // ==== Transfer RSR from the draft pool
        totalDrafts = newTotalDrafts;
        draftRSR = newDraftRSR;

        // == Interactions ==
        leakyRefresh(rsrAmount);
        IERC20Upgradeable(address(rsr)).safeTransfer(account, rsrAmount);
        emit UnstakingCompleted(firstId, endId, draftEra, account, rsrAmount);

        // == Checks ==
        require(basketHandler.isReady() && basketHandler.fullyCollateralized(), "RToken readying");
    }

    /// Cancel an ongoing unstaking; resume staking
    /// @custom:interaction CEI
    function cancelUnstake(uint256 endId) external {
        _requireNotFrozen();
        address account = _msgSender();

        // We specifically allow cancelling unstaking when undercollateralized
        // require(basketHandler.isReady() && basketHandler.fullyCollateralized(), """);

        uint256 firstId = firstRemainingDraft[draftEra][account];
        CumulativeDraft[] storage queue = draftQueues[draftEra][account];
        if (endId == 0 || firstId >= endId) return;

        require(endId <= queue.length, "index out-of-bounds");

        // Cancelling unstake does not require checking if the unstaking was available
        // require(queue[endId - 1].availableAt <= block.timestamp, "withdrawal unavailable");

        // untestable:
        //      firstId will never be zero, due to previous checks against endId
        uint192 oldDrafts = firstId != 0 ? queue[firstId - 1].drafts : 0;
        uint192 draftAmount = queue[endId - 1].drafts - oldDrafts;

        // advance queue past withdrawal
        firstRemainingDraft[draftEra][account] = endId;

        // ==== Compute RSR amount
        uint256 newTotalDrafts = totalDrafts - draftAmount;
        // newDraftRSR: {qRSR} = {qDrafts} * D18 / D18{qDrafts/qRSR}
        uint256 newDraftRSR = (newTotalDrafts * FIX_ONE_256 + (draftRate - 1)) / draftRate;
        uint256 rsrAmount = draftRSR - newDraftRSR;

        if (rsrAmount == 0) return;

        // Payout rewards before updating draftRSR
        _payoutRewards();

        // ==== Transfer RSR from the draft pool
        totalDrafts = newTotalDrafts;
        draftRSR = newDraftRSR;
        emit UnstakingCancelled(firstId, endId, draftEra, account, rsrAmount);

        // Mint new stakes
        mintStakes(account, rsrAmount);
    }

    /// @param rsrAmount {qRSR}
    /// Must seize at least `rsrAmount`, or revert
    /// @custom:protected
    // let:
    //   keepRatio = 1 - (rsrAmount / rsr.balanceOf(this))
    //
    // checks:
    //   0 < rsrAmount <= rsr.balanceOf(this)
    //   not paused (trading) or frozen
    //   caller is backingManager
    //
    // effects, in two phases. Phase 1: (from x to x')
    //   stakeRSR' = floor(stakeRSR * keepRatio)
    //   totalStakes' = totalStakes
    //   stakeRate' = ceil(totalStakes' * 1e18 / stakeRSR')
    //
    //   draftRSR' = floor(draftRSR * keepRatio)
    //   totalDrafts' = totalDrafts
    //   draftRate' = ceil(totalDrafts' * 1e18 / draftRSR')
    //
    //   let fromRewards = floor(rsrRewards() * (1 - keepRatio))
    //
    // effects phase 2: (from x' to x'')
    //   draftRSR'' = (draftRSR' <= MAX_DRAFT_RATE) ? draftRSR' : 0
    //   if draftRSR'' = 0, then totalDrafts'' = 0 and draftRate'' = FIX_ONE
    //   stakeRSR'' = (stakeRSR' <= MAX_STAKE_RATE) ? stakeRSR' : 0
    //   if stakeRSR'' = 0, then totalStakes'' = 0 and stakeRate'' = FIX_ONE
    //
    // actions:
    //   as (this), rsr.transfer(backingManager, seized)
    //   where seized = draftRSR - draftRSR'' + stakeRSR - stakeRSR'' + fromRewards
    //
    // other properties:
    //   seized >= rsrAmount, which should be a logical consequence of the above effects
    function seizeRSR(uint256 rsrAmount) external {
        _requireNotTradingPausedOrFrozen();
        _notZero(rsrAmount);

        address caller = _msgSender();
        require(caller == address(backingManager), "!bm");

        uint256 rsrBalance = rsr.balanceOf(address(this));
        require(rsrAmount <= rsrBalance, "seize exceeds balance");

        _payoutRewards();

        uint256 seizedRSR;
        uint192 initRate = exchangeRate();
        uint256 rewards = rsrRewards();

        // Remove RSR from stakeRSR
        uint256 stakeRSRToTake = (stakeRSR * rsrAmount + (rsrBalance - 1)) / rsrBalance;
        stakeRSR -= stakeRSRToTake;
        seizedRSR = stakeRSRToTake;

        // update stakeRate, possibly beginning a new stake era
        if (stakeRSR != 0) {
            // Downcast is safe: totalStakes is 1e38 at most so expression maximum value is 1e56
            stakeRate = uint192((FIX_ONE_256 * totalStakes + (stakeRSR - 1)) / stakeRSR);
        }
        if (stakeRSR == 0 || stakeRate > MAX_STAKE_RATE) {
            seizedRSR += stakeRSR;
            beginEra();
        }

        // Remove RSR from draftRSR
        uint256 draftRSRToTake = (draftRSR * rsrAmount + (rsrBalance - 1)) / rsrBalance;
        draftRSR -= draftRSRToTake;
        seizedRSR += draftRSRToTake;

        // update draftRate, possibly beginning a new draft era
        if (draftRSR != 0) {
            // Downcast is safe: totalDrafts is 1e38 at most so expression maximum value is 1e56
            draftRate = uint192((FIX_ONE_256 * totalDrafts + (draftRSR - 1)) / draftRSR);
        }

        if (draftRSR == 0 || draftRate > MAX_DRAFT_RATE) {
            seizedRSR += draftRSR;
            beginDraftEra();
        }

        // Remove RSR from yet-unpaid rewards (implicitly)
        seizedRSR += (rewards * rsrAmount + (rsrBalance - 1)) / rsrBalance;
        rsrRewardsAtLastPayout = rsrRewards() - seizedRSR;

        // Transfer RSR to caller
        emit ExchangeRateSet(initRate, exchangeRate());
        IERC20Upgradeable(address(rsr)).safeTransfer(caller, seizedRSR);
    }

    /// @custom:governance
    /// Reset all stakes and advance era
    /// @notice This function is only callable when the stake rate is unsafe.
    ///     The stake rate is unsafe when it is either too high or too low.
    ///     There is the possibility of the rate reaching the borderline of being unsafe,
    ///     where users won't stake in fear that a reset might be executed.
    ///     A user may also grief this situation by staking enough RSR to vote against any reset.
    ///     This standoff will continue until enough RSR is staked and a reset is executed.
    ///     There is currently no good and easy way to mitigate the possibility of this situation,
    ///     and the risk of it occurring is low enough that it is not worth the effort to mitigate.
    function resetStakes() external {
        _requireGovernanceOnly();
        require(
            stakeRate <= MIN_SAFE_STAKE_RATE || stakeRate >= MAX_SAFE_STAKE_RATE,
            "rate still safe"
        );

        beginEra();
        beginDraftEra();
    }

    /// @return D18{qRSR/qStRSR} The exchange rate between RSR and StRSR
    function exchangeRate() public view returns (uint192) {
        // D18{qRSR/qStRSR} = D18 * D18 / D18{qStRSR/qRSR}
        return (FIX_SCALE_SQ + (stakeRate / 2)) / stakeRate; // ROUND method
    }

    /// Return the maximum value of endId such that withdraw(endId) can immediately work
    // let r = draft[account]
    // returns:
    //   if r.left == r.right: r.right (i.e, withdraw 0 drafts)
    //   else: the least id such that r.left <= id <= r.right and r.queue[id].availableAt > now
    function endIdForWithdraw(address account) external view returns (uint256) {
        uint256 time = block.timestamp;
        CumulativeDraft[] storage queue = draftQueues[draftEra][account];

        // Bounds our search for the current cumulative draft
        (uint256 left, uint256 right) = (firstRemainingDraft[draftEra][account], queue.length);

        // If there are no drafts to be found, return 0 drafts
        if (left >= right) return right;
        if (queue[left].availableAt > time) return left;

        // Otherwise, there *are* drafts with left <= index < right and availableAt <= time.
        // Binary search:
        uint256 test;
        while (left < right - 1) {
            // Loop invariants, because without great care a binary search is usually wrong:
            // - queue[left].availableAt <= time
            // - either right == queue.length or queue[right].availableAt > time
            test = (left + right) / 2; // left < test < right because left < right - 1
            if (queue[test].availableAt <= time) left = test;
            else right = test;
        }
        return right;
    }

    /// Used by FacadeP1
    /// @return The length of the draft queue for an account in an era
    function draftQueueLen(uint256 era_, address account) external view returns (uint256) {
        return draftQueues[era_][account].length;
    }

    /// @return {qDrafts} The amount of RSR currently being withdrawn
    function getDraftRSR() external view returns (uint256) {
        return draftRSR;
    }

    /// @return {qRSR} The amount of RSR currently being staked and earning rewards
    function getStakeRSR() external view returns (uint256) {
        return stakeRSR;
    }

    /// @return {qDrafts} The amount of StRSR currently being withdrawn
    function getTotalDrafts() external view returns (uint256) {
        return totalDrafts;
    }

    /// @return {draftEra} The current era for drafts (withdrawals)
    function getDraftEra() external view returns (uint256) {
        return draftEra;
    }

    // ==== Internal Functions ====

    /// Assign reward payouts to the staker pool
    /// @dev do this by effecting stakeRSR and payoutLastPaid as appropriate, given the current
    /// value of rsrRewards()
    /// @dev perhaps astonishingly, this _isn't_ a refresher

    // let
    //   N = numPeriods; the number of whole rewardPeriods since the last payout
    //   payout = rsrRewards() * (1 - (1 - rewardRatio)^N)  (see [strsr-payout-formula])
    //
    // effects:
    //   stakeRSR' = stakeRSR + payout
    //   rsrRewards'() = rsrRewards() - payout   (implicit in the code, but true)
    //   stakeRate' = ceil(totalStakes' * 1e18 / stakeRSR')  (because [stake-rate])
    //     unless totalStakes == 0 or stakeRSR == 0, in which case stakeRate' = FIX_ONE
    //   totalStakes' = totalStakes
    //
    // [strsr-payout-formula]:
    //   The process we're modelling is:
    //     N = number of whole rewardPeriods since last _payoutRewards() call
    //     rewards_0 = rsrRewards()
    //     payout_{i+1} = rewards_i * payoutRatio
    //     rewards_{i+1} = rewards_i - payout_{i+1}
    //     payout = sum{payout_i for i in [1...N]}
    //   thus:
    //     rewards_N = rewards_0 - payout
    //     rewards_{i+1} = rewards_i - rewards_i * payoutRatio = rewards_i * (1-payoutRatio)
    //     rewards_N = rewards_0 * (1-payoutRatio) ^ N
    //     payout = rewards_N - rewards_0 = rewards_0 * (1 - (1-payoutRatio)^N)
    function _payoutRewards() internal {
        if (block.timestamp < payoutLastPaid + 1) return;
        uint48 numPeriods = uint48(block.timestamp) - payoutLastPaid;

        uint192 initRate = exchangeRate();
        uint256 payout;

        // Do an actual payout if and only if enough RSR is staked!
        if (totalStakes >= FIX_ONE) {
            // Paying out the ratio r, N times, equals paying out the ratio (1 - (1-r)^N) 1 time.
            // Apply payout to RSR backing
            // payoutRatio: D18 = FIX_ONE: D18 - FixLib.powu(): D18
            // Both uses of uint192(-) are fine, as it's equivalent to FixLib.sub().
            uint192 payoutRatio = FIX_ONE - FixLib.powu(FIX_ONE - rewardRatio, numPeriods);

            // payout: {qRSR} = D18{1} * {qRSR} / D18
            payout = (payoutRatio * rsrRewardsAtLastPayout) / FIX_ONE;
            stakeRSR += payout;
        }

        payoutLastPaid += numPeriods;
        rsrRewardsAtLastPayout = rsrRewards();

        // stakeRate else case: D18{qStRSR/qRSR} = {qStRSR} * D18 / {qRSR}
        // downcast is safe: it's at most 1e38 * 1e18 = 1e56
        // untestable:
        //      the second half of the OR comparison is untestable because of the invariant:
        //      if totalStakes == 0, then stakeRSR == 0
        stakeRate = (stakeRSR == 0 || totalStakes == 0)
            ? FIX_ONE
            : uint192((totalStakes * FIX_ONE_256 + (stakeRSR - 1)) / stakeRSR);

        emit RewardsPaid(payout);
        emit ExchangeRateSet(initRate, exchangeRate());
    }

    /// @param rsrAmount {qRSR}
    /// @return index The index of the draft
    /// @return availableAt {s} The timestamp the cumulative draft vests
    // effects:
    //   draftRSR' = draftRSR + rsrAmount
    //   draftRate' = draftRate    (ie, unchanged)
    //   totalDrafts' = floor(draftRSR' * draftRate' / 1e18)
    //   r'.left = r.left
    //   r'.right = r.right + 1
    //   r'.queue is r.queue with a new entry appeneded for (totalDrafts' - totalDraft) drafts
    //   where r = draft[account] and r' = draft'[account]
    function pushDraft(address account, uint256 rsrAmount)
        internal
        returns (uint256 index, uint64 availableAt)
    {
        // draftAmount: how many drafts to create and assign to the user
        // pick draftAmount as big as we can such that (newTotalDrafts <= newDraftRSR * draftRate)
        draftRSR += rsrAmount;
        // newTotalDrafts: {qDrafts} = D18{qDrafts/qRSR} * {qRSR} / D18
        uint256 newTotalDrafts = (draftRate * draftRSR) / FIX_ONE;
        uint256 draftAmount = newTotalDrafts - totalDrafts;
        totalDrafts = newTotalDrafts;

        // Push drafts into account's draft queue
        CumulativeDraft[] storage queue = draftQueues[draftEra][account];
        index = queue.length;

        uint192 oldDrafts = index != 0 ? queue[index - 1].drafts : 0;
        uint64 lastAvailableAt = index != 0 ? queue[index - 1].availableAt : 0;
        availableAt = uint64(block.timestamp) + unstakingDelay;
        if (lastAvailableAt > availableAt) {
            availableAt = lastAvailableAt;
        }

        queue.push(CumulativeDraft(uint176(oldDrafts + draftAmount), availableAt));
    }

    /// Zero all stakes and withdrawals
    /// Overriden in StRSRVotes to handle rebases
    // effects:
    //   stakeRSR' = totalStakes' = 0
    //   stakeRate' = FIX_ONE
    function beginEra() internal virtual {
        stakeRSR = 0;
        totalStakes = 0;
        stakeRate = FIX_ONE;
        era++;

        emit AllBalancesReset(era);
    }

    // effects:
    //  draftRSR' = totalDrafts' = 0
    //  draftRate' = FIX_ONE
    function beginDraftEra() internal virtual {
        draftRSR = 0;
        totalDrafts = 0;
        draftRate = FIX_ONE;
        draftEra++;

        emit AllUnstakingReset(draftEra);
    }

    /// @return {qRSR} The balance of RSR that this contract owns dedicated to future RSR rewards.
    function rsrRewards() internal view returns (uint256) {
        return rsr.balanceOf(address(this)) - stakeRSR - draftRSR;
    }

    /// Refresh if too much RSR has exited since the last refresh occurred
    /// @param rsrWithdrawal {qRSR} How much RSR is being withdrawn
    /// Effects-Refresh
    function leakyRefresh(uint256 rsrWithdrawal) private {
        uint48 lastRefresh = assetRegistry.lastRefresh(); // {s}

        // Assumption: rsrWithdrawal has already been taken out of draftRSR
        uint256 totalRSR = stakeRSR + draftRSR + rsrWithdrawal; // {qRSR}
        uint192 withdrawal = _safeWrap((rsrWithdrawal * FIX_ONE + totalRSR - 1) / totalRSR); // {1}

        // == Effects ==
        leaked = lastWithdrawRefresh != lastRefresh ? withdrawal : leaked + withdrawal;
        lastWithdrawRefresh = lastRefresh;

        if (leaked > withdrawalLeak) {
            leaked = 0;
            lastWithdrawRefresh = uint48(block.timestamp);

            /// == Refresh ==
            assetRegistry.refresh();
        }
    }

    /// Mint stakes corresponding to rsrAmount to an account
    /// @param rsrAmount {qRSR} The RSR amount being staked
    function mintStakes(address account, uint256 rsrAmount) private {
        // This is not an overflow risk according to our expected ranges:
        //   rsrAmount <= 1e29, totalStaked <= 1e38, 1e29 * 1e38 < 2^256.
        // stakeAmount: how many stRSR the user shall receive.
        // pick stakeAmount as big as we can such that (newTotalStakes <= newStakeRSR * stakeRate)
        uint256 newStakeRSR = stakeRSR + rsrAmount;
        // newTotalStakes: {qStRSR} = D18{qStRSR/qRSR} * {qRSR} / D18
        uint256 newTotalStakes = (stakeRate * newStakeRSR) / FIX_ONE;
        uint256 stakeAmount = newTotalStakes - totalStakes;

        // Transfer RSR from account to this contract
        stakeRSR += rsrAmount;
        _mint(account, stakeAmount);
        emit Staked(era, account, rsrAmount, stakeAmount);
    }

    // contract-size-saver
    // solhint-disable-next-line no-empty-blocks
    function _requireNotTradingPausedOrFrozen() private notTradingPausedOrFrozen {}

    // contract-size-saver
    // solhint-disable-next-line no-empty-blocks
    function _requireNotFrozen() private notFrozen {}

    // contract-size-saver
    // solhint-disable-next-line no-empty-blocks
    function _requireGovernanceOnly() private governance {}

    // ==== ERC20 ====
    // This section extracted from ERC20; adjusted to work with stakes/eras
    // name(), symbol(), and decimals() are all auto-generated

    function totalSupply() public view returns (uint256) {
        return totalStakes;
    }

    function balanceOf(address account) public view returns (uint256) {
        return stakes[era][account];
    }

    function allowance(address owner, address spender)
        public
        view
        virtual
        override
        returns (uint256)
    {
        return _allowances[era][owner][spender];
    }

    function transfer(address to, uint256 amount) public returns (bool) {
        _transfer(_msgSender(), to, amount);
        return true;
    }

    /**
     * NOTE: If `amount` is the maximum `uint256`, the allowance is not updated on
     * `transferFrom`. This is semantically equivalent to an infinite approval.
     */
    function approve(address spender, uint256 amount) public returns (bool) {
        _approve(_msgSender(), spender, amount);
        return true;
    }

    /**
     * NOTE: Does not update the allowance if the current allowance
     * is the maximum `uint256`.
     */
    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) public returns (bool) {
        _spendAllowance(from, _msgSender(), amount);
        _transfer(from, to, amount);
        return true;
    }

    function increaseAllowance(address spender, uint256 addedValue) public returns (bool) {
        address owner = _msgSender();
        _approve(owner, spender, _allowances[era][owner][spender] + addedValue);
        return true;
    }

    function decreaseAllowance(address spender, uint256 subtractedValue) public returns (bool) {
        address owner = _msgSender();
        uint256 currentAllowance = _allowances[era][owner][spender];
        require(currentAllowance >= subtractedValue, "decrease allowance");
        unchecked {
            _approve(owner, spender, currentAllowance - subtractedValue);
        }

        return true;
    }

    // checks: from != 0, to != 0,
    // effects: bal[from] -= amount; bal[to] += amount;
    function _transfer(
        address from,
        address to,
        uint256 amount
    ) internal {
        _notZero(from);
        _notZero(to);

        mapping(address => uint256) storage eraStakes = stakes[era];
        uint256 fromBalance = eraStakes[from];
        require(fromBalance >= amount, "insufficient balance");
        unchecked {
            eraStakes[from] = fromBalance - amount;
        }
        eraStakes[to] += amount;

        emit Transfer(from, to, amount);
        _afterTokenTransfer(from, to, amount);
    }

    // checks: account != 0; totalStakes' < 2^224 - 1  (for StRSRVotes)
    // effects: bal[account] += amount; totalStakes += amount
    // this must only be called from a function that will fixup stakeRSR/Rate
    function _mint(address account, uint256 amount) internal virtual {
        _notZero(account);
        assert(totalStakes + amount < type(uint224).max);

        stakes[era][account] += amount;
        totalStakes += amount;

        emit Transfer(address(0), account, amount);
        _afterTokenTransfer(address(0), account, amount);
    }

    // checks: account != 0; bal[account] >= amount
    // effects: bal[account] -= amount; totalStakes -= amount;
    // this must only be called from a function that will fixup stakeRSR/Rate
    function _burn(address account, uint256 amount) internal virtual {
        // untestable:
        //      _burn is only called from unstake(), which uses msg.sender as `account`
        _notZero(account);

        mapping(address => uint256) storage eraStakes = stakes[era];
        uint256 accountBalance = eraStakes[account];
        // untestable:
        //      _burn is only called from unstake(), which already checks this
        require(accountBalance >= amount, "insufficient balances");
        unchecked {
            eraStakes[account] = accountBalance - amount;
        }
        totalStakes -= amount;

        emit Transfer(account, address(0), amount);
        _afterTokenTransfer(account, address(0), amount);
    }

    function _approve(
        address owner,
        address spender,
        uint256 amount
    ) internal {
        _notZero(owner);
        _notZero(spender);

        _allowances[era][owner][spender] = amount;
        emit Approval(owner, spender, amount);
    }

    function _spendAllowance(
        address owner,
        address spender,
        uint256 amount
    ) internal {
        uint256 currentAllowance = _allowances[era][owner][spender];
        if (currentAllowance != type(uint256).max) {
            require(currentAllowance >= amount, "insufficient allowance");
            unchecked {
                _approve(owner, spender, currentAllowance - amount);
            }
        }
    }

    /// Used by StRSRVotes to track voting
    // solhint-disable no-empty-blocks
    function _afterTokenTransfer(
        address,
        address to,
        uint256
    ) internal virtual {
        require(to != address(this), "transfer to self");
    }

    function _notZero(address addr) internal pure {
        require(addr != address(0), "zero address");
    }

    function _notZero(uint256 val) internal pure {
        require(val != 0, "zero amount");
    }

    // === ERC20Permit ===
    // This section extracted from OZ:ERC20PermitUpgradeable

    function permit(
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) public {
        require(block.timestamp <= deadline, "ERC20Permit: expired deadline");

        bytes32 structHash = keccak256(
            abi.encode(_PERMIT_TYPEHASH, owner, spender, value, _useNonce(owner), deadline)
        );

        PermitLib.requireSignature(owner, _hashTypedDataV4(structHash), v, r, s);

        _approve(owner, spender, value);
    }

    function nonces(address owner) public view returns (uint256) {
        return _nonces[owner].current();
    }

    function delegationNonces(address owner) public view returns (uint256) {
        return _delegationNonces[owner].current();
    }

    // solhint-disable-next-line func-name-mixedcase
    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function _useNonce(address owner) internal returns (uint256 current) {
        CountersUpgradeable.Counter storage nonce = _nonces[owner];
        current = nonce.current();
        nonce.increment();
    }

    function _useDelegationNonce(address owner) internal returns (uint256 current) {
        CountersUpgradeable.Counter storage nonce = _delegationNonces[owner];
        current = nonce.current();
        nonce.increment();
    }

    // ==== Gov Param Setters ====

    /// @custom:governance
    function setUnstakingDelay(uint48 val) public {
        _requireGovernanceOnly();
        require(val > MIN_UNSTAKING_DELAY && val <= MAX_UNSTAKING_DELAY, "invalid unstakingDelay");
        emit UnstakingDelaySet(unstakingDelay, val);
        unstakingDelay = val;
    }

    /// @custom:governance
    function setRewardRatio(uint192 val) public {
        _requireGovernanceOnly();
        _payoutRewards();
        require(val <= MAX_REWARD_RATIO, "invalid rewardRatio");
        emit RewardRatioSet(rewardRatio, val);
        rewardRatio = val;
    }

    /// @custom:governance
    function setWithdrawalLeak(uint192 val) public {
        _requireGovernanceOnly();
        require(val <= MAX_WITHDRAWAL_LEAK, "invalid withdrawalLeak");
        emit WithdrawalLeakSet(withdrawalLeak, val);
        withdrawalLeak = val;
    }

    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
     */
    uint256[28] private __gap;
}
