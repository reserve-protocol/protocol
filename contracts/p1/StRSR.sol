// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

// solhint-disable-next-line max-line-length
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/draft-ERC20PermitUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20VotesUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/Counters.sol";
import "contracts/interfaces/IStRSR.sol";
import "contracts/interfaces/IMain.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/p1/mixins/Component.sol";

/*
 * @title StRSRP1
 * @notice StRSR is an ERC20 token contract that allows people to stake their RSR as insurance
 *   behind an RToken. As compensation stakers receive a share of revenues in the form of RSR.
 *   Balances are generally non-rebasing. As rewards are paid out StRSR becomes redeemable for
 *   increasing quantities of RSR.
 *
 * The one time that StRSR will rebase is if the entirety of insurance RSR is seized. If this
 *   happens, users balances are zereod out and StRSR is re-issued at a 1:1 exchange rate with RSR
 *
 * There's an important assymetry in StRSR: when RSR is added it must be split only
 *   across non-withdrawing stakes, while when RSR is seized it is seized uniformly from both
 *   stakes that are in the process of being withdrawn and those that are not.
 */
// solhint-disable max-states-count
abstract contract StRSRP1 is Initializable, ComponentP1, IStRSR, EIP712Upgradeable {
    using CountersUpgradeable for CountersUpgradeable.Counter;
    using SafeERC20Upgradeable for IERC20Upgradeable;

    // === History ===
    /*
     * When the stakeRate falls below the MIN_EXCHANGE_RATE, all balances are wiped and
     * a new era begins.
     */

    // Min exchange rate {qRSR/qStRSR}
    uint192 private constant MIN_EXCHANGE_RATE = uint192(1e9); // 1e-9 D18{1}

    // Era. If ever there's a total RSR wipeout, increment the era to zero old balances in one step.
    uint256 internal era;

    /// @param fromBlock The block number at which the exchange rate was first reached
    /// @param rate {qStRSR/qRSR} The exchange rate at the time as a Fix
    struct HistoricalExchangeRate {
        uint32 fromBlock;
        uint192 rate;
    }

    // History of all past exchange rates, recorded on each payoutRewards + seizeRSR
    HistoricalExchangeRate[] internal exchangeRateHistory;

    // === ERC20 ===

    string public name; // mutable
    string public symbol; // mutable
    // solhint-disable const-name-snakecase
    uint8 public constant decimals = 18;

    // era => (owner => (spender => {qStRSR}))
    mapping(uint256 => mapping(address => mapping(address => uint256))) private _allowances;

    /// === Stakes (balances) ===

    // Typically: "balances". These are the tokenized staking positions!
    // era => ({account} => {qStRSR})
    mapping(uint256 => mapping(address => uint256)) private stakes; // Stakes per account {qStRSR}
    uint256 internal totalStakes; // Total of all stakes {qStRSR}
    uint256 internal stakeRSR; // Amount of RSR backing all stakes {qRSR}
    uint192 public stakeRate; // The exchange rate between stakes and RSR. {qStRSR/qRSR}

    // === Drafts ===

    // Drafts: share of the withdrawing tokens. Not transferrable and not revenue-earning.
    struct CumulativeDraft {
        // Avoid re-using uint192 in order to avoid confusion with our type system; 176 is enough
        uint176 drafts; // Total amount of drafts that will become available // {qDraft}
        uint64 availableAt; // When the last of the drafts will become available
    }
    // era => ({account} => {drafts})
    mapping(uint256 => mapping(address => CumulativeDraft[])) public draftQueues; // {drafts}
    mapping(uint256 => mapping(address => uint256)) public firstRemainingDraft; // draft index
    uint256 internal totalDrafts; // Total of all drafts {qDrafts}
    uint256 internal draftRSR; // Amount of RSR backing all drafts {qRSR}
    uint192 public draftRate; // The exchange rate between drafts and RSR. {qDrafts/qRSR}

    // === ERC20Permit ===

    mapping(address => CountersUpgradeable.Counter) private _nonces;

    // solhint-disable-next-line var-name-mixedcase
    bytes32 private constant _PERMIT_TYPEHASH =
        keccak256(
            "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
        );

    // ==== Gov Params ====

    uint32 public unstakingDelay; // {s} The minimum loength of time spent in the draft queue
    uint32 public rewardPeriod; // {s} The number of seconds between revenue payout events
    uint192 public rewardRatio; // {1} The fraction of the revenue balance to handout per period

    // === Cache ===

    // {qRSR} How much reward RSR was held the last time rewards were paid out
    uint256 internal rsrRewardsAtLastPayout;

    // {seconds} The last tim rewards were paid out
    uint32 internal payoutLastPaid;

    // ======================

    function init(
        IMain main_,
        string calldata name_,
        string calldata symbol_,
        uint32 unstakingDelay_,
        uint32 rewardPeriod_,
        uint192 rewardRatio_
    ) external initializer {
        __Component_init(main_);
        __EIP712_init(name_, "1");
        name = name_;
        symbol = symbol_;
        payoutLastPaid = uint32(block.timestamp);
        rsrRewardsAtLastPayout = main_.rsr().balanceOf(address(this));
        unstakingDelay = unstakingDelay_;
        rewardPeriod = rewardPeriod_;
        rewardRatio = rewardRatio_;
        require(rewardPeriod * 2 <= unstakingDelay, "unstakingDelay/rewardPeriod incompatible");

        // Add initial exchange rate
        exchangeRateHistory.push(HistoricalExchangeRate(uint32(block.number), FIX_ONE));

        beginEra();
    }

    /// Assign reward payouts to the staker pool
    /// @custom:refresher
    function payoutRewards() external notPaused {
        _payoutRewards();
    }

    /// Stakes an RSR `amount` on the corresponding RToken to earn yield and insure the system
    /// @param rsrAmount {qRSR}
    /// @custom:interaction CEI
    function stake(uint256 rsrAmount) external interaction {
        require(rsrAmount > 0, "Cannot stake zero");

        _payoutRewards();

        // Compute stake amount
        // This is not an overflow risk according to our expected ranges:
        //   rsrAmount <= 1e29, totalStaked <= 1e38, 1e29 * 1e38 < 2^256.
        // stakeAmount: how many stRSR the user shall receive.
        // pick stakeAmount as big as we can such that (newTotalStakes <= newStakeRSR * stakeRate)
        uint256 newStakeRSR = stakeRSR + rsrAmount;
        uint256 newTotalStakes = (stakeRate * newStakeRSR) / FIX_ONE;
        uint256 stakeAmount = newTotalStakes - totalStakes;

        // Update staked
        address account = _msgSender();
        stakeRSR += rsrAmount;
        _mint(account, stakeAmount);

        // Transfer RSR from account to this contract
        emit Staked(era, account, rsrAmount, stakeAmount);

        // == Interactions ==
        IERC20Upgradeable(address(main.rsr())).safeTransferFrom(account, address(this), rsrAmount);
    }

    /// Begins a delayed unstaking for `amount` StRSR
    /// @param stakeAmount {qStRSR}
    function unstake(uint256 stakeAmount) external notPaused {
        address account = _msgSender();
        require(stakeAmount > 0, "Cannot withdraw zero");
        require(stakes[era][account] >= stakeAmount, "Not enough balance");

        _payoutRewards();

        // ==== Compute changes to stakes and RSR accounting
        // rsrAmount: how many RSR to move from the stake pool to the draft pool
        // pick rsrAmount as big as we can such that (newTotalStakes <= newStakeRSR * stakeRate)
        _burn(account, stakeAmount);

        // {qRSR} = D18 * {qStRSR} / D18{qStRSR/qRSR}
        uint256 newStakeRSR = (FIX_ONE_256 * totalStakes) / stakeRate;
        uint256 rsrAmount = stakeRSR - newStakeRSR;
        stakeRSR = newStakeRSR;

        // Create draft
        (uint256 index, uint64 availableAt) = pushDraft(account, rsrAmount);
        emit UnstakingStarted(index, era, account, rsrAmount, stakeAmount, availableAt);
    }

    /// Complete delayed unstaking for an account, up to but not including `endId`
    /// @custom:interaction RCEI
    function withdraw(address account, uint256 endId) external interaction {
        // == Refresh ==
        main.assetRegistry().refresh();

        // == Checks + Effects ==
        IBasketHandler bh = main.basketHandler();
        require(bh.fullyCapitalized(), "RToken uncapitalized");
        require(bh.status() == CollateralStatus.SOUND, "basket defaulted");

        uint256 firstId = firstRemainingDraft[era][account];
        CumulativeDraft[] storage queue = draftQueues[era][account];
        if (endId == 0 || firstId >= endId) return;

        require(endId <= queue.length, "index out-of-bounds");
        require(queue[endId - 1].availableAt <= block.timestamp, "withdrawal unavailable");

        uint192 oldDrafts = firstId > 0 ? queue[firstId - 1].drafts : 0;
        uint192 draftAmount = queue[endId - 1].drafts - oldDrafts;

        // advance queue past withdrawal
        firstRemainingDraft[era][account] = endId;

        // ==== Compute RSR amount
        uint256 newTotalDrafts = totalDrafts - draftAmount;
        uint256 newDraftRSR = (newTotalDrafts * FIX_ONE_256) / draftRate;
        uint256 rsrAmount = draftRSR - newDraftRSR;

        if (rsrAmount == 0) return;

        // ==== Transfer RSR from the draft pool
        totalDrafts = newTotalDrafts;
        draftRSR = newDraftRSR;

        emit UnstakingCompleted(firstId, endId, era, account, rsrAmount);

        // == Interaction ==
        IERC20Upgradeable(address(main.rsr())).safeTransfer(account, rsrAmount);
    }

    /// @param rsrAmount {qRSR}
    /// Must always seize exactly `rsrAmount`, or revert
    /// @custom:protected
    function seizeRSR(uint256 rsrAmount) external notPaused {
        require(_msgSender() == address(main.backingManager()), "not backing manager");
        require(rsrAmount > 0, "Amount cannot be zero");
        uint192 initRate = stakeRate;

        uint256 rsrBalance = main.rsr().balanceOf(address(this));
        require(rsrAmount <= rsrBalance, "Cannot seize more RSR than we hold");
        if (rsrBalance == 0) return;

        // Calculate dust RSR threshold, the point at which we might as well call it a wipeout
        uint256 dustRSRAmt = (MIN_EXCHANGE_RATE * (totalDrafts + totalStakes)) / FIX_ONE; // {qRSR}
        uint256 seizedRSR;
        if (rsrBalance <= rsrAmount + dustRSRAmt) {
            // Rebase event: total RSR stake wipeout
            seizedRSR = rsrBalance;
            beginEra();
        } else {
            uint256 rewards = rsrRewards();

            // Remove RSR evenly from stakeRSR, draftRSR, and the reward pool
            uint256 stakeRSRToTake = (stakeRSR * rsrAmount + (rsrBalance - 1)) / rsrBalance;
            stakeRSR -= stakeRSRToTake;
            seizedRSR = stakeRSRToTake;
            stakeRate = stakeRSR == 0 ? FIX_ONE : uint192((FIX_ONE_256 * totalStakes) / stakeRSR);

            uint256 draftRSRToTake = (draftRSR * rsrAmount + (rsrBalance - 1)) / rsrBalance;
            draftRSR -= draftRSRToTake;
            seizedRSR += draftRSRToTake;
            draftRate = draftRSR == 0 ? FIX_ONE : uint192((FIX_ONE_256 * totalDrafts) / draftRSR);

            // Removing from unpaid rewards is implicit
            seizedRSR += (rewards * rsrAmount + (rsrBalance - 1)) / rsrBalance;
        }

        // Transfer RSR to caller
        emit ExchangeRateSet(initRate, stakeRate);
        exchangeRateHistory.push(HistoricalExchangeRate(uint32(block.number), stakeRate));
        IERC20Upgradeable(address(main.rsr())).safeTransfer(_msgSender(), seizedRSR);
    }

    /// @return {qStRSR/qRSR} The exchange rate between StRSR and RSR
    function exchangeRate() public view returns (uint192) {
        return stakeRate;
    }

    /// Return the maximum valid value of endId such that withdraw(endId) should immediately work
    /// This search may be slightly expensive.
    /// TODO: experiment! For what values of queue.length - firstId is this actually cheaper
    ///     than linear search?
    function endIdForWithdraw(address account) external view returns (uint256) {
        uint256 time = block.timestamp;
        CumulativeDraft[] storage queue = draftQueues[era][account];

        // Bounds our search for the current cumulative draft
        (uint256 left, uint256 right) = (firstRemainingDraft[era][account], queue.length);

        // If there are no drafts to be found, return 0 drafts
        if (left >= right) return right;
        if (queue[left].availableAt > time) return left;

        // Otherwise, there *are* drafts with left <= index < right and availableAt <= time.
        // Binary search, keeping true that (queue[left].availableAt <= time) and
        //   (right == queue.length or queue[right].availableAt > time)
        uint256 test;
        while (left < right - 1) {
            test = (left + right) / 2;
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

    // ==== Internal Functions ====

    /// Assign reward payouts to the staker pool
    /// @dev do this by effecting stakeRSR and payoutLastPaid as appropriate, given the current
    /// value of rsrRewards()
    /// @dev perhaps astonishingly, this _isn't_ a refresher
    function _payoutRewards() internal {
        if (block.timestamp < payoutLastPaid + rewardPeriod) return;
        uint32 numPeriods = (uint32(block.timestamp) - payoutLastPaid) / rewardPeriod;

        uint192 initRate = stakeRate;

        // Paying out the ratio r, N times, equals paying out the ratio (1 - (1-r)^N) 1 time.
        // Apply payout to RSR backing
        uint192 payoutRatio = FIX_ONE - FixLib.powu(FIX_ONE - rewardRatio, numPeriods);

        stakeRSR += (payoutRatio * rsrRewardsAtLastPayout) / FIX_ONE;
        payoutLastPaid += numPeriods * rewardPeriod;
        rsrRewardsAtLastPayout = rsrRewards();

        stakeRate = (stakeRSR == 0 || totalStakes == 0)
            ? FIX_ONE
            : uint192((totalStakes * FIX_ONE_256) / stakeRSR);

        emit ExchangeRateSet(initRate, stakeRate);
        exchangeRateHistory.push(HistoricalExchangeRate(uint32(block.number), stakeRate));
    }

    /// @param rsrAmount {qRSR}
    /// @return index The index of the draft
    /// @return availableAt {s} The timestamp the cumulative draft vests
    function pushDraft(address account, uint256 rsrAmount)
        internal
        returns (uint256 index, uint64 availableAt)
    {
        // draftAmount: how many drafts to create and assign to the user
        // pick draftAmount as big as we can such that (newTotalDrafts <= newDraftRSR * draftRate)
        draftRSR += rsrAmount;
        uint256 newTotalDrafts = (draftRate * draftRSR) / FIX_ONE;

        // equivalently, here: uint(draftRate) * draftRSR / FIX_ONE
        uint256 draftAmount = newTotalDrafts - totalDrafts;
        totalDrafts = newTotalDrafts;

        // Push drafts into account's draft queue
        CumulativeDraft[] storage queue = draftQueues[era][account];
        index = queue.length;

        uint192 oldDrafts = index > 0 ? queue[index - 1].drafts : 0;
        uint64 lastAvailableAt = index > 0 ? queue[index - 1].availableAt : 0;
        availableAt = uint64(block.timestamp) + unstakingDelay;
        if (lastAvailableAt > uint64(block.timestamp) + unstakingDelay) {
            availableAt = lastAvailableAt;
        }

        queue.push(CumulativeDraft(uint176(oldDrafts + draftAmount), availableAt));
    }

    /// Zero all stakes and withdrawals
    /// Overriden in StRSRVotes to handle rebases
    function beginEra() internal virtual {
        stakeRSR = 0;
        draftRSR = 0;
        totalStakes = 0;
        totalDrafts = 0;
        stakeRate = FIX_ONE;
        draftRate = FIX_ONE;
        era++;

        emit AllBalancesReset(era);
    }

    /// @return {qRSR} The balance of RSR that this contract owns dedicated to future RSR rewards.
    function rsrRewards() internal view returns (uint256) {
        return main.rsr().balanceOf(address(this)) - stakeRSR - draftRSR;
    }

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
        address owner = _msgSender();
        _transfer(owner, to, amount);
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
        require(currentAllowance >= subtractedValue, "ERC20: decreased allowance below zero");
        unchecked {
            _approve(owner, spender, currentAllowance - subtractedValue);
        }

        return true;
    }

    function _transfer(
        address from,
        address to,
        uint256 amount
    ) internal {
        require(from != address(0), "ERC20: transfer from the zero address");
        require(to != address(0), "ERC20: transfer to the zero address");

        mapping(address => uint256) storage eraStakes = stakes[era];
        uint256 fromBalance = eraStakes[from];
        require(fromBalance >= amount, "ERC20: transfer amount exceeds balance");
        unchecked {
            eraStakes[from] = fromBalance - amount;
        }
        eraStakes[to] += amount;

        emit Transfer(from, to, amount);

        _afterTokenTransfer(from, to, amount);
    }

    function _mint(address account, uint256 amount) internal virtual {
        require(account != address(0), "ERC20: mint to the zero address");
        assert(totalStakes + amount < type(uint224).max);

        stakes[era][account] += amount;
        totalStakes += amount;

        emit Transfer(address(0), account, amount);
        _afterTokenTransfer(address(0), account, amount);
    }

    function _burn(address account, uint256 amount) internal virtual {
        require(account != address(0), "ERC20: burn from the zero address");

        mapping(address => uint256) storage eraStakes = stakes[era];
        uint256 accountBalance = eraStakes[account];
        require(accountBalance >= amount, "ERC20: burn amount exceeds balance");
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
        require(owner != address(0), "ERC20: approve from the zero address");
        require(spender != address(0), "ERC20: approve to the zero address");

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
            require(currentAllowance >= amount, "ERC20: insufficient allowance");
            unchecked {
                _approve(owner, spender, currentAllowance - amount);
            }
        }
    }

    /// Used by StRSRVotes to track voting
    // solhint-disable no-empty-blocks
    function _afterTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal virtual {}

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

        bytes32 hash = _hashTypedDataV4(structHash);

        address signer = ECDSAUpgradeable.recover(hash, v, r, s);
        require(signer == owner, "ERC20Permit: invalid signature");

        _approve(owner, spender, value);
    }

    function nonces(address owner) public view returns (uint256) {
        return _nonces[owner].current();
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

    // ==== Gov Param Setters ====

    function setName(string calldata name_) external governance {
        name = name_;
    }

    function setSymbol(string calldata symbol_) external governance {
        symbol = symbol_;
    }

    /// @custom:governance
    function setUnstakingDelay(uint32 val) external governance {
        emit UnstakingDelaySet(unstakingDelay, val);
        unstakingDelay = val;
        require(rewardPeriod * 2 <= unstakingDelay, "unstakingDelay/rewardPeriod incompatible");
    }

    /// @custom:governance
    function setRewardPeriod(uint32 val) external governance {
        emit RewardPeriodSet(rewardPeriod, val);
        rewardPeriod = val;
        require(rewardPeriod * 2 <= unstakingDelay, "unstakingDelay/rewardPeriod incompatible");
    }

    /// @custom:governance
    function setRewardRatio(uint192 val) external governance {
        emit RewardRatioSet(rewardRatio, val);
        rewardRatio = val;
    }
}
