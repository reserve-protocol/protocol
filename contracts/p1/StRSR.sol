// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/utils/cryptography/draft-EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/Counters.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "contracts/interfaces/IAsset.sol";
import "contracts/interfaces/IStRSR.sol";
import "contracts/interfaces/IMain.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/p0/Component.sol";

/*
 * @title StRSR
 * @notice The StRSR is where people can stake their RSR in order to provide insurance and
 * benefit from the supply expansion of an RToken.
 *
 * There's an important assymetry in the StRSR. When RSR is added, it must be split only
 * across non-withdrawing stakes, while when RSR is seized, it must be seized from both
 * stakes that are in the process of being withdrawn and those that are not.
 */
// solhint-disable max-states-count
contract StRSR is IStRSR, Component, EIP712 {
    using SafeERC20 for IERC20;
    using EnumerableSet for EnumerableSet.AddressSet;
    using FixLib for Fix;

    // ==== ERC20Permit ====

    using Counters for Counters.Counter;

    mapping(address => Counters.Counter) private _nonces;

    // solhint-disable-next-line var-name-mixedcase
    bytes32 private immutable _PERMIT_TYPEHASH =
        keccak256(
            "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
        );

    // ====

    // Staking Token Name and Symbol
    string private _name;
    string private _symbol;

    // Era. If ever there's a total RSR wipeout, increment the era to zero old balances in one step.
    uint256 internal era = 0;

    // Stakes: usual staking position. These are the token stakes!
    mapping(uint256 => mapping(address => uint256)) private stakes; // Stakes per account {qStRSR}
    uint256 internal totalStakes; // Total of all stakes {qStakes}
    uint256 internal stakeRSR; // Amount of RSR backing all stakes {qRSR}

    // Drafts: share of the withdrawing tokens. Not transferrable.
    // Draft queues by account. Handle only through pushDrafts() and withdraw(). Indexed by era.
    mapping(uint256 => mapping(address => CumulativeDraft[])) public draftQueues;
    mapping(uint256 => mapping(address => uint256)) public firstRemainingDraft;
    uint256 internal totalDrafts; // Total of all drafts {qDrafts}
    uint256 internal draftRSR; // Amount of RSR backing all drafts {qRSR}

    // ERC20 allowances of stakes
    mapping(address => mapping(address => uint256)) private allowances;

    // {seconds} The last time stRSR paid out rewards to stakers
    uint256 internal payoutLastPaid;

    // Delayed drafts
    struct CumulativeDraft {
        uint256 drafts; // Total amount of drafts that will become available
        uint256 startedAt; // When the last of those drafts started
    }

    // ==== Gov Params ====
    uint256 public unstakingDelay;
    uint256 public rewardPeriod;
    Fix public rewardRatio;

    constructor(string memory name_, string memory symbol_) EIP712(name_, "1") Component() {
        _name = name_;
        _symbol = symbol_;
    }

    function init(ConstructorArgs calldata args) internal override {
        payoutLastPaid = block.timestamp;
        unstakingDelay = args.params.unstakingDelay;
        rewardPeriod = args.params.rewardPeriod;
        rewardRatio = args.params.rewardRatio;
        require(rewardPeriod * 2 <= unstakingDelay, "unstakingDelay/rewardPeriod incompatible");
    }

    /// Stakes an RSR `amount` on the corresponding RToken to earn yield and insure the system
    /// User Action
    /// @param rsrAmount {qRSR}
    function stake(uint256 rsrAmount) external notPaused {
        address account = _msgSender();
        require(rsrAmount > 0, "Cannot stake zero");

        // Process pending withdrawals
        payoutRewards();
        _stake(account, rsrAmount);
    }

    /// Begins a delayed unstaking for `amount` stRSR
    /// User Action
    /// @param stakeAmount {qRSR}
    function unstake(uint256 stakeAmount) external notPaused {
        address account = _msgSender();
        IBasketHandler bh = main.basketHandler();

        require(stakeAmount > 0, "Cannot withdraw zero");
        require(stakes[era][account] >= stakeAmount, "Not enough balance");

        require(bh.fullyCapitalized(), "RToken uncapitalized");
        require(bh.status() == CollateralStatus.SOUND, "basket defaulted");

        // Process pending withdrawals
        payoutRewards();
        _unstake(account, stakeAmount);
    }

    /// Complete delayed unstking, up to but not including `endId`
    /// User Action.
    function withdraw(uint256 endId) external notPaused {
        address account = _msgSender();
        IBasketHandler bh = main.basketHandler();
        require(bh.fullyCapitalized(), "RToken uncapitalized");
        require(bh.status() == CollateralStatus.SOUND, "basket defaulted");

        CumulativeDraft[] storage queue = draftQueues[era][account];
        require(endId <= queue.length, "index out-of-bounds");

        uint256 time = block.timestamp - unstakingDelay;
        require(queue[endId - 1].startedAt <= time, "withdrawal unavailable");
        _withdraw(account, endId);
    }

    /// @param rsrAmount {qRSR}
    /// @return seizedRSR {qRSR} The actual rsrAmount seized.
    /// seizedRSR might be dust-larger than rsrAmount due to rounding.
    /// seizedRSR might be smaller than rsrAmount if we're out of RSR.
    function seizeRSR(uint256 rsrAmount) external returns (uint256 seizedRSR) {
        require(_msgSender() == address(main), "not main");
        require(rsrAmount > 0, "Amount cannot be zero");

        uint256 rsrBalance = main.rsr().balanceOf(address(this));

        if (rsrBalance == 0) return 0;
        if (rsrBalance <= rsrAmount) {
            // Total RSR stake wipeout.
            seizedRSR = rsrBalance;

            // Zero all stakes and withdrawals
            stakeRSR = 0;
            draftRSR = 0;
            era++;

            emit AllBalancesReset();
        } else {
            // Remove RSR evenly from stakeRSR, draftRSR, and the reward pool
            uint256 stakeRSRToTake = (stakeRSR * rsrAmount + (rsrBalance - 1)) / rsrBalance;
            stakeRSR -= stakeRSRToTake;
            seizedRSR = stakeRSRToTake;

            uint256 draftRSRToTake = (draftRSR * rsrAmount + (rsrBalance - 1)) / rsrBalance;
            draftRSR -= draftRSRToTake;
            seizedRSR += draftRSRToTake;

            // Removing from unpaid rewards is implicit
            uint256 rewardsToTake = (rsrRewards() * rsrAmount + (rsrBalance - 1)) / rsrBalance;
            seizedRSR += rewardsToTake;

            assert(rsrAmount <= seizedRSR);
        }

        // Transfer RSR to caller
        main.rsr().safeTransfer(_msgSender(), seizedRSR);
        emit RSRSeized(_msgSender(), seizedRSR);
    }

    /// Assign reward payouts to the staker pool
    /// @dev do this by effecting stakeRSR and payoutLastPaid as appropriate, given the current
    /// value of rsrRewards()
    function payoutRewards() public {
        if (block.timestamp < payoutLastPaid + rewardPeriod) return;

        uint256 numPeriods = (block.timestamp - payoutLastPaid) / rewardPeriod;

        // Paying out the ratio r, N times, equals paying out the ratio (1 - (1-r)^N) 1 time.
        Fix payoutRatio = FIX_ONE.minus(FIX_ONE.minus(rewardRatio).powu(numPeriods));
        uint256 payout = payoutRatio.mulu(rsrRewards()).floor();

        // Apply payout to RSR backing
        stakeRSR += payout;
        payoutLastPaid += numPeriods * rewardPeriod;

        emit RSRRewarded(payout, numPeriods);
    }

    function setMain(IMain main_) external virtual onlyOwner {
        emit MainSet(main, main_);
        main = main_;
    }

    /// Return the maximum valid value of endId such that withdraw(endId) should immediately work
    /// This search may be slightly expensive.
    /// TODO: experiment! For what values of queue.length - firstId is this actually cheaper
    ///     than linear search?
    function endIdForWithdraw(address account) external view returns (uint256) {
        uint256 time = block.timestamp - unstakingDelay;
        CumulativeDraft[] storage queue = draftQueues[era][account];

        // Bounds our search for the current cumulative draft
        (uint256 left, uint256 right) = (firstRemainingDraft[era][account], queue.length);

        // If there are no drafts to be found, return 0 drafts
        if (left >= right) return right;
        if (queue[left].startedAt > time) return left;

        // Otherwise, there *are* drafts with left <= index < right and startedAt <= time.
        // Binary search, keeping true that (queue[left].startedAt <= time) and
        //   (right == queue.length or queue[right].startedAt > time)
        while (left < right - 1) {
            uint256 test = (left + right) / 2;
            if (queue[test].startedAt <= time) left = test;
            else right = test;
        }
        return right;
    }

    // ==== ERC20 Interface ====
    function name() public view returns (string memory) {
        return _name;
    }

    function symbol() public view returns (string memory) {
        return _symbol;
    }

    function decimals() public pure returns (uint8) {
        return 18;
    }

    function totalSupply() external view returns (uint256) {
        return totalStakes;
    }

    function balanceOf(address account) external view returns (uint256) {
        return stakes[era][account];
    }

    function transfer(address recipient, uint256 amount) external returns (bool) {
        _transfer(_msgSender(), recipient, amount);
        return true;
    }

    function _transfer(
        address sender,
        address recipient,
        uint256 amount
    ) private {
        require(sender != address(0), "ERC20: transfer from the zero address");
        require(recipient != address(0), "ERC20: transfer to the zero address");
        require(stakes[era][sender] >= amount, "ERC20: transfer amount exceeds balance");
        stakes[era][sender] -= amount;
        stakes[era][recipient] += amount;
    }

    function allowance(address owner_, address spender) public view returns (uint256) {
        return allowances[owner_][spender];
    }

    function approve(address spender, uint256 amount) public returns (bool) {
        _approve(_msgSender(), spender, amount);
        return true;
    }

    function transferFrom(
        address sender,
        address recipient,
        uint256 amount
    ) public returns (bool) {
        _transfer(sender, recipient, amount);

        uint256 currentAllowance = allowances[sender][_msgSender()];
        require(currentAllowance >= amount, "ERC20: transfer amount exceeds allowance");
        _approve(sender, _msgSender(), currentAllowance - amount);
        return true;
    }

    function _approve(
        address owner_,
        address spender,
        uint256 amount
    ) private {
        require(owner_ != address(0), "ERC20: approve from the zero address");
        require(spender != address(0), "ERC20: approve to the zero address");

        allowances[owner_][spender] = amount;

        emit Approval(owner_, spender, amount);
    }

    // ==== end ERC20 Interface ====

    // ==== Internal Functions ====
    /// @return {qRSR} The balance of RSR that this contract owns dedicated to future RSR rewards.
    function rsrRewards() internal view returns (uint256) {
        return main.rsr().balanceOf(address(this)) - stakeRSR - draftRSR;
    }

    /* On staking R RSR, you get R * (totalStakes/stakeRSR) stakes
       On unstaking S stakes, you get S * (stakeRSR/totalStakes) * (totalDrafts/draftRSR) drafts
       On withdrawing D drafts, you get D * (draftRSR/totalDrafts) RSR

       Each conversion rate is taken to be 1 if its denominator is 0 -- this is fine, because that's
       setting the rate in the first place.
     */

    /// Execute the staking of `rsrAmount` RSR for `account`
    function _stake(address account, uint256 rsrAmount) internal {
        // Transfer RSR from account to this contract
        main.rsr().safeTransferFrom(account, address(this), rsrAmount);

        // Compute stake amount
        uint256 stakeAmount = (stakeRSR == 0) ? rsrAmount : (rsrAmount * totalStakes) / stakeRSR;

        // Add to stakeAmount to stakes
        stakes[era][account] += stakeAmount;
        totalStakes += stakeAmount;
        stakeRSR += rsrAmount;

        emit Staked(account, rsrAmount, stakeAmount);
    }

    /// Execute the move of `stakeAmount` from stake to draft, for `account`
    function _unstake(address account, uint256 stakeAmount) internal {
        // Compute draft and RSR amounts
        uint256 rsrAmount = (stakeAmount * stakeRSR) / totalStakes;
        uint256 draftAmount = (draftRSR == 0) ? rsrAmount : (rsrAmount * totalDrafts) / draftRSR;

        // Reduce stake balance
        stakes[era][account] -= stakeAmount;
        totalStakes -= stakeAmount;
        stakeRSR -= rsrAmount;

        // Increase draft balance
        totalDrafts += draftAmount;
        draftRSR += rsrAmount;

        // Push drafts into account's draft queue
        pushDrafts(account, draftAmount);

        emit UnstakingStarted(
            draftQueues[era][account].length - 1,
            account,
            rsrAmount,
            stakeAmount
        );
    }

    /// Execute the completion of all drafts,
    /// from firstRemainingDraft[era][account] up to (but not including!) endId
    function _withdraw(address account, uint256 endId) internal {
        uint256 firstId = firstRemainingDraft[era][account];
        if (firstId >= endId) return;

        CumulativeDraft[] storage queue = draftQueues[era][account];
        uint256 oldDrafts = firstId > 0 ? queue[firstId - 1].drafts : 0;
        uint256 draftAmount = queue[endId - 1].drafts - oldDrafts;

        // advance queue past withdrawal
        firstRemainingDraft[era][account] = endId;

        // Compute RSR amount and transfer it from the draft pool
        uint256 rsrAmount = (draftAmount * draftRSR) / totalDrafts;
        if (rsrAmount == 0) return;

        totalDrafts -= draftAmount;
        draftRSR -= rsrAmount;
        main.rsr().safeTransfer(account, rsrAmount);

        emit UnstakingCompleted(firstId, endId, account, rsrAmount);
    }

    /// Add a cumulative draft to account's draft queue (at the current time).
    function pushDrafts(address account, uint256 draftAmount) internal {
        CumulativeDraft[] storage queue = draftQueues[era][account];

        uint256 oldDrafts = queue.length > 0 ? queue[queue.length - 1].drafts : 0;

        queue.push(CumulativeDraft(oldDrafts + draftAmount, block.timestamp));
    }

    // ==== end Internal Functions ====

    // === ERC20Permit ====

    // From OZ 4.4 release at commit 6bd6b76

    function permit(
        address owner_,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) public virtual {
        require(block.timestamp <= deadline, "ERC20Permit: expired deadline");

        bytes32 structHash = keccak256(
            abi.encode(_PERMIT_TYPEHASH, owner_, spender, value, _useNonce(owner_), deadline)
        );

        bytes32 hash = _hashTypedDataV4(structHash);

        address signer = ECDSA.recover(hash, v, r, s);
        require(signer == owner_, "ERC20Permit: invalid signature");

        _approve(owner_, spender, value);
    }

    function nonces(address owner_) public view virtual returns (uint256) {
        return _nonces[owner_].current();
    }

    // solhint-disable-next-line func-name-mixedcase
    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function _useNonce(address owner_) internal virtual returns (uint256 current) {
        Counters.Counter storage nonce = _nonces[owner_];
        current = nonce.current();
        nonce.increment();
    }

    // ==== End ERC20Permit ====

    // ==== Gov Param Setters ====

    function setUnstakingDelay(uint256 val) external onlyOwner {
        emit UnstakingDelaySet(unstakingDelay, val);
        unstakingDelay = val;
        require(rewardPeriod * 2 <= unstakingDelay, "unstakingDelay/rewardPeriod incompatible");
    }

    function setRewardPeriod(uint256 val) external onlyOwner {
        emit RewardPeriodSet(rewardPeriod, val);
        rewardPeriod = val;
        require(rewardPeriod * 2 <= unstakingDelay, "unstakingDelay/rewardPeriod incompatible");
    }

    function setRewardRatio(Fix val) external onlyOwner {
        emit RewardRatioSet(rewardRatio, val);
        rewardRatio = val;
    }
}
