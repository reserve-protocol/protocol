// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/draft-EIP712Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/ECDSAUpgradeable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/Counters.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/interfaces/IAsset.sol";
import "contracts/interfaces/IStRSR.sol";
import "contracts/interfaces/IMain.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/p1/mixins/Component.sol";

/*
 * @title StRSRP1
 * @notice The StRSR is where people can stake their RSR in order to provide insurance and
 * benefit from the supply expansion of an RToken.
 *
 * There's an important assymetry in the StRSR. When RSR is added, it must be split only
 * across non-withdrawing stakes, while when RSR is seized, it must be seized from both
 * stakes that are in the process of being withdrawn and those that are not.
 */
// solhint-disable max-states-count
contract StRSRP1 is IStRSR, ComponentP1, EIP712Upgradeable {
    using SafeERC20Upgradeable for IERC20Upgradeable;
    using EnumerableSet for EnumerableSet.AddressSet;
    using FixLib for int192;

    // ==== ERC20Permit ====

    using Counters for Counters.Counter;

    mapping(address => Counters.Counter) private _nonces;

    // solhint-disable-next-line var-name-mixedcase
    bytes32 private constant _PERMIT_TYPEHASH =
        keccak256(
            "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
        );

    // ====

    // Staking Token Name and Symbol
    string private _name;
    string private _symbol;

    // Era. If ever there's a total RSR wipeout, increment the era to zero old balances in one step.
    uint256 internal era;

    // Stakes: usual staking position. These are the token stakes!
    mapping(uint256 => mapping(address => uint256)) private stakes; // Stakes per account {qStRSR}
    uint256 internal totalStakes; // Total of all stakes {qStakes}
    uint256 internal stakeRSR; // Amount of RSR backing all stakes {qRSR}

    // ==== Unstaking Gov Param ====
    uint32 public unstakingDelay;

    // Drafts: share of the withdrawing tokens. Not transferrable.
    // Draft queues by account. Handle only through pushDrafts() and withdraw(). Indexed by era.
    mapping(uint256 => mapping(address => CumulativeDraft[])) public draftQueues;
    mapping(uint256 => mapping(address => uint256)) public firstRemainingDraft;
    uint256 internal totalDrafts; // Total of all drafts {qDrafts}
    uint256 internal draftRSR; // Amount of RSR backing all drafts {qRSR}

    // ERC20 allowances of stakes
    mapping(address => mapping(address => uint256)) private allowances;

    // {qRSR} How much reward RSR was held the last time rewards were paid out
    uint256 internal rsrRewardsAtLastPayout;

    // Delayed drafts
    struct CumulativeDraft {
        uint256 drafts; // Total amount of drafts that will become available
        uint256 availableAt; // When the last of the drafts will become available
    }

    // Min exchange rate {qRSR/qStRSR}
    int192 private constant MIN_EXCHANGE_RATE = int192(1e9); // 1e-9

    // {seconds} The last time stRSR paid out rewards to stakers
    uint32 internal payoutLastPaid;

    // ==== Reward Gov Params ====
    uint32 public rewardPeriod;
    int192 public rewardRatio;

    function init(
        IMain main_,
        string calldata name_,
        string calldata symbol_,
        uint32 unstakingDelay_,
        uint32 rewardPeriod_,
        int192 rewardRatio_
    ) external initializer {
        __Component_init(main_);
        __EIP712_init(name_, "1");
        _name = name_;
        _symbol = symbol_;
        payoutLastPaid = uint32(block.timestamp);
        rsrRewardsAtLastPayout = main_.rsr().balanceOf(address(this));
        unstakingDelay = unstakingDelay_;
        rewardPeriod = rewardPeriod_;
        rewardRatio = rewardRatio_;
        require(rewardPeriod * 2 <= unstakingDelay, "unstakingDelay/rewardPeriod incompatible");
    }

    /// Stakes an RSR `amount` on the corresponding RToken to earn yield and insure the system
    /// @param rsrAmount {qRSR}
    /// @custom:action
    function stake(uint256 rsrAmount) external notPaused {
        address account = _msgSender();
        require(rsrAmount > 0, "Cannot stake zero");

        // Process pending withdrawals
        payoutRewards();
        _stake(account, rsrAmount);
    }

    /// Begins a delayed unstaking for `amount` StRSR
    /// @param stakeAmount {qStRSR}
    /// @custom:action
    function unstake(uint256 stakeAmount) external notPaused {
        address account = _msgSender();
        IBasketHandler bh = main.basketHandler();

        require(stakeAmount > 0, "Cannot withdraw zero");
        require(stakes[era][account] >= stakeAmount, "Not enough balance");

        // TODO I think we can get rid of this for gas optimization, since `withdraw` handles it
        main.assetRegistry().forceUpdates();

        require(bh.fullyCapitalized(), "RToken uncapitalized");
        require(bh.status() == CollateralStatus.SOUND, "basket defaulted");

        // Process pending withdrawals
        payoutRewards();
        _unstake(account, stakeAmount);
    }

    /// Complete delayed unstaking for an account, up to but not including `endId`
    /// @custom:completion
    function withdraw(address account, uint256 endId) external notPaused {
        main.assetRegistry().forceUpdates();

        IBasketHandler bh = main.basketHandler();
        require(bh.fullyCapitalized(), "RToken uncapitalized");
        require(bh.status() == CollateralStatus.SOUND, "basket defaulted");

        CumulativeDraft[] storage queue = draftQueues[era][account];
        if (endId == 0) return;
        require(endId <= queue.length, "index out-of-bounds");

        require(queue[endId - 1].availableAt <= block.timestamp, "withdrawal unavailable");
        _withdraw(account, endId);
    }

    /// @param rsrAmount {qRSR}
    /// seizedRSR might be dust-larger than rsrAmount due to rounding.
    /// seizedRSR might be smaller than rsrAmount if we're out of RSR.
    function seizeRSR(uint256 rsrAmount) external {
        require(_msgSender() == address(main.backingManager()), "not backing manager");
        require(rsrAmount > 0, "Amount cannot be zero");
        int192 initialExchangeRate = exchangeRate();
        uint256 rsrBalance = main.rsr().balanceOf(address(this));
        require(rsrAmount <= rsrBalance, "Cannot seize more RSR than we hold");
        if (rsrBalance == 0) return;

        // Calculate dust RSR threshold, the point at which we might as well call it a wipeout
        uint256 allStakes = totalDrafts + totalStakes; // {qStRSR}
        uint256 dustRSRAmt = MIN_EXCHANGE_RATE.mulu_toUint(allStakes); // {qRSR}

        uint256 seizedRSR;
        if (rsrBalance <= rsrAmount + dustRSRAmt) {
            // Total RSR stake wipeout.
            seizedRSR = rsrBalance;

            // Zero all stakes and withdrawals
            stakeRSR = 0;
            draftRSR = 0;
            totalStakes = 0;
            era++;

            emit AllBalancesReset(era);
        } else {
            uint256 rewards = rsrRewards();

            // Remove RSR evenly from stakeRSR, draftRSR, and the reward pool
            uint256 stakeRSRToTake = (stakeRSR * rsrAmount + (rsrBalance - 1)) / rsrBalance;
            stakeRSR -= stakeRSRToTake;
            seizedRSR = stakeRSRToTake;

            uint256 draftRSRToTake = (draftRSR * rsrAmount + (rsrBalance - 1)) / rsrBalance;
            draftRSR -= draftRSRToTake;
            seizedRSR += draftRSRToTake;

            // Removing from unpaid rewards is implicit
            uint256 rewardsToTake = (rewards * rsrAmount + (rsrBalance - 1)) / rsrBalance;
            seizedRSR += rewardsToTake;

            assert(rsrAmount <= seizedRSR);
        }

        // Transfer RSR to caller
        emit ExchangeRateSet(initialExchangeRate, exchangeRate());
        IERC20Upgradeable(address(main.rsr())).safeTransfer(_msgSender(), seizedRSR);
    }

    /// Assign reward payouts to the staker pool
    /// @dev do this by effecting stakeRSR and payoutLastPaid as appropriate, given the current
    /// value of rsrRewards()
    function payoutRewards() public {
        if (block.timestamp < payoutLastPaid + rewardPeriod) return;
        int192 initialExchangeRate = exchangeRate();

        uint32 numPeriods = (uint32(block.timestamp) - payoutLastPaid) / rewardPeriod;

        // Paying out the ratio r, N times, equals paying out the ratio (1 - (1-r)^N) 1 time.
        int192 payoutRatio = FIX_ONE.minus(FIX_ONE.minus(rewardRatio).powu(numPeriods));
        uint256 payout = payoutRatio.mulu_toUint(rsrRewardsAtLastPayout);

        // Apply payout to RSR backing
        stakeRSR += payout;
        payoutLastPaid += numPeriods * rewardPeriod;
        rsrRewardsAtLastPayout = rsrRewards();

        emit ExchangeRateSet(initialExchangeRate, exchangeRate());
    }

    function exchangeRate() public view returns (int192) {
        int8 d = int8(decimals());
        uint256 numerator = draftRSR + stakeRSR;
        uint256 denominator = totalDrafts + totalStakes;
        if (numerator == 0 || denominator == 0) return FIX_ONE;

        return shiftl_toFix(numerator, -d).div(shiftl_toFix(denominator, -d));
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
        while (left < right - 1) {
            uint256 test = (left + right) / 2;
            if (queue[test].availableAt <= time) left = test;
            else right = test;
        }
        return right;
    }

    // ==== ERC20 Interface ====
    function name() external view returns (string memory) {
        return _name;
    }

    function symbol() external view returns (string memory) {
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

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(_msgSender(), to, amount);
        return true;
    }

    function _transfer(
        address from,
        address to,
        uint256 amount
    ) private {
        require(from != address(0), "ERC20: transfer from the zero address");
        require(to != address(0), "ERC20: transfer to the zero address");

        uint256 fromBalance = stakes[era][from];

        require(fromBalance >= amount, "ERC20: transfer amount exceeds balance");

        unchecked {
            stakes[era][from] = fromBalance - amount;
        }

        stakes[era][to] += amount;
    }

    function allowance(address owner_, address spender) public view returns (uint256) {
        return allowances[owner_][spender];
    }

    function approve(address spender, uint256 amount) public returns (bool) {
        _approve(_msgSender(), spender, amount);
        return true;
    }

    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) public returns (bool) {
        _spendAllowance(from, _msgSender(), amount);
        _transfer(from, to, amount);
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

    function increaseAllowance(address spender, uint256 addedValue) external returns (bool) {
        address owner_ = _msgSender();
        _approve(owner_, spender, allowances[owner_][spender] + addedValue);
        return true;
    }

    function decreaseAllowance(address spender, uint256 subtractedValue) external returns (bool) {
        address owner_ = _msgSender();
        uint256 currentAllowance = allowances[owner_][spender];
        require(currentAllowance >= subtractedValue, "ERC20: decreased allowance below zero");
        unchecked {
            _approve(owner_, spender, currentAllowance - subtractedValue);
        }

        return true;
    }

    function _spendAllowance(
        address owner_,
        address spender,
        uint256 amount
    ) internal {
        uint256 currentAllowance = allowance(owner_, spender);
        if (currentAllowance != type(uint256).max) {
            require(currentAllowance >= amount, "ERC20: insufficient allowance");
            unchecked {
                _approve(owner_, spender, currentAllowance - amount);
            }
        }
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
        // Compute stake amount
        // This is not an overflow risk according to our expected ranges:
        //   rsrAmount <= 1e29, totalStaked <= 1e38, 1e29 * 1e38 < 2^256.
        uint256 stakeAmount = (stakeRSR == 0) ? rsrAmount : (rsrAmount * totalStakes) / stakeRSR;

        // Add to stakeAmount to stakes
        stakes[era][account] += stakeAmount;
        totalStakes += stakeAmount;
        stakeRSR += rsrAmount;

        // Transfer RSR from account to this contract
        emit Staked(account, rsrAmount, stakeAmount);
        IERC20Upgradeable(address(main.rsr())).safeTransferFrom(account, address(this), rsrAmount);
    }

    /// Execute the move of `stakeAmount` from stake to draft, for `account`
    function _unstake(address account, uint256 stakeAmount) internal {
        // Compute draft and RSR amounts
        //    (dividing out totalStakes, before multiplying by totalDrafts, is necessary here
        //    to avoid overflow, possibly at the cost of some precision)
        //    (We should use uint256 muldiv here, instead!)
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
        uint256 index = draftQueues[era][account].length;
        pushDrafts(account, draftAmount);
        emit UnstakingStarted(
            index,
            era,
            account,
            rsrAmount,
            stakeAmount,
            draftQueues[era][account][index].availableAt
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

        emit UnstakingCompleted(firstId, endId, era, account, rsrAmount);
        IERC20Upgradeable(address(main.rsr())).safeTransfer(account, rsrAmount);
    }

    /// Add a cumulative draft to account's draft queue (from the current time).
    function pushDrafts(address account, uint256 draftAmount) internal {
        CumulativeDraft[] storage queue = draftQueues[era][account];

        uint256 oldDrafts = queue.length > 0 ? queue[queue.length - 1].drafts : 0;
        uint256 lastAvailableAt = queue.length > 0 ? queue[queue.length - 1].availableAt : 0;
        uint256 availableAt = Math.max(block.timestamp + unstakingDelay, lastAvailableAt);

        queue.push(CumulativeDraft(oldDrafts + draftAmount, availableAt));
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
    ) public {
        require(block.timestamp <= deadline, "ERC20Permit: expired deadline");

        bytes32 structHash = keccak256(
            abi.encode(_PERMIT_TYPEHASH, owner_, spender, value, _useNonce(owner_), deadline)
        );

        bytes32 hash = _hashTypedDataV4(structHash);

        address signer = ECDSAUpgradeable.recover(hash, v, r, s);
        require(signer == owner_, "ERC20Permit: invalid signature");

        _approve(owner_, spender, value);
    }

    function nonces(address owner_) public view returns (uint256) {
        return _nonces[owner_].current();
    }

    // solhint-disable-next-line func-name-mixedcase
    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function _useNonce(address owner_) internal returns (uint256 current) {
        Counters.Counter storage nonce = _nonces[owner_];
        current = nonce.current();
        nonce.increment();
    }

    // ==== End ERC20Permit ====

    // ==== Gov Param Setters ====

    function setUnstakingDelay(uint32 val) external onlyOwner {
        emit UnstakingDelaySet(unstakingDelay, val);
        unstakingDelay = val;
        require(rewardPeriod * 2 <= unstakingDelay, "unstakingDelay/rewardPeriod incompatible");
    }

    function setRewardPeriod(uint32 val) external onlyOwner {
        emit RewardPeriodSet(rewardPeriod, val);
        rewardPeriod = val;
        require(rewardPeriod * 2 <= unstakingDelay, "unstakingDelay/rewardPeriod incompatible");
    }

    function setRewardRatio(int192 val) external onlyOwner {
        emit RewardRatioSet(rewardRatio, val);
        rewardRatio = val;
    }
}
