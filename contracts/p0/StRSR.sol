// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/utils/cryptography/draft-EIP712Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/ECDSAUpgradeable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/Counters.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "contracts/interfaces/IAsset.sol";
import "contracts/interfaces/IBasketHandler.sol";
import "contracts/interfaces/IStRSR.sol";
import "contracts/interfaces/IMain.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/p0/mixins/Component.sol";

/*
 * @title StRSRP0
 * @notice The StRSR is where people can stake their RSR in order to provide insurance and
 * benefit from the supply expansion of an RToken.
 *
 * There's an important assymetry in the StRSR. When RSR is added, it must be split only
 * across non-withdrawing balances, while when RSR is seized, it must be seized from both
 * balances that are in the process of being withdrawn and those that are not.
 */
contract StRSRP0 is IStRSR, ComponentP0, EIP712Upgradeable {
    using SafeERC20 for IERC20;
    using EnumerableSet for EnumerableSet.AddressSet;
    using FixLib for int192;

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

    // Balances per account
    mapping(address => uint256) private balances;
    mapping(address => mapping(address => uint256)) private allowances;

    // List of accounts. If balances[user] > 0 then (user is in accounts)
    EnumerableSet.AddressSet internal accounts;

    // {qStRSR} Total of all stRSR balances, not including pending withdrawals
    uint256 internal totalStaked;

    // {qRSR} How much RSR is allocated to backing currently-staked balances
    uint256 internal rsrBacking;

    // {seconds} The last time stRSR paid out rewards to stakers
    uint256 internal payoutLastPaid;

    // {qRSR} How much reward RSR was held the last time rewards were paid out
    uint256 internal rsrRewardsAtLastPayout;

    // Era. If ever there's a total RSR wipeout, this is incremented
    // This is only really here for equivalence with P1, which requires it
    uint256 internal era;

    // The momentary stake/unstake rate is rsrBacking/totalStaked {RSR/stRSR}
    // That rate is locked in when slow unstaking *begins*

    // Delayed Withdrawals
    struct Withdrawal {
        address account;
        uint256 rsrAmount; // How much rsr this withdrawal will be redeemed for, if none is seized
        uint256 stakeAmount; // How much stRSR this withdrawal represents; immutable after creation
        uint256 availableAt;
    }

    // Withdrawal queues by account
    mapping(address => Withdrawal[]) public withdrawals;

    // Min exchange rate {qRSR/qStRSR} (compile-time constant)
    int192 private constant MIN_EXCHANGE_RATE = int192(1e9); // 1e-9

    // ==== Gov Params ====
    uint32 public unstakingDelay;
    uint32 public rewardPeriod;
    int192 public rewardRatio;

    function init(
        IMain main_,
        string memory name_,
        string memory symbol_,
        uint32 unstakingDelay_,
        uint32 rewardPeriod_,
        int192 rewardRatio_
    ) public initializer {
        __Component_init(main_);
        __EIP712_init(name_, "1");
        _name = name_;
        _symbol = symbol_;
        payoutLastPaid = block.timestamp;
        rsrRewardsAtLastPayout = main_.rsr().balanceOf(address(this));
        unstakingDelay = unstakingDelay_;
        rewardPeriod = rewardPeriod_;
        rewardRatio = rewardRatio_;
        era = 1;
        require(rewardPeriod * 2 <= unstakingDelay, "unstakingDelay/rewardPeriod incompatible");
    }

    /// Stakes an RSR `amount` on the corresponding RToken to earn yield and insure the system
    /// @param rsrAmount {qRSR}
    /// @custom:action
    function stake(uint256 rsrAmount) external notPaused {
        address account = _msgSender();
        require(rsrAmount > 0, "Cannot stake zero");

        // Run state keepers
        main.poke();
        payoutRewards();

        uint256 stakeAmount = rsrAmount;
        // The next line is _not_ an overflow risk, in our expected ranges:
        // rsrAmount <= 1e29 and totalStaked <= 1e38, so their product <= 1e67 < 1e77 < 2^256
        if (totalStaked > 0) stakeAmount = (rsrAmount * totalStaked) / rsrBacking;

        // Create stRSR balance
        if (balances[account] == 0) accounts.add(account);
        balances[account] += stakeAmount;
        totalStaked += stakeAmount;

        // Move deposited RSR to backing
        rsrBacking += rsrAmount;

        emit Staked(era, account, rsrAmount, stakeAmount);
        main.rsr().safeTransferFrom(account, address(this), rsrAmount);
    }

    /// Begins a delayed unstaking for `amount` stRSR
    /// @param stakeAmount {qStRSR}
    /// @custom:action
    function unstake(uint256 stakeAmount) external notPaused {
        address account = _msgSender();
        require(stakeAmount > 0, "Cannot withdraw zero");
        require(balances[account] >= stakeAmount, "Not enough balance");

        // Call state keepers
        main.poke();
        payoutRewards();

        // The next line is not an overflow risk:
        // stakeAmount = rsrAmount * (totalStaked / rsrBacking) <= 1e29 * 1e9 = 1e38
        // rsrBacking <= 1e29 (an RSR amount)
        // so stakeAmount * rsrBacking <= 1e67 < 2^256
        uint256 rsrAmount = (stakeAmount * rsrBacking) / totalStaked;

        // Destroy the stRSR balance
        balances[account] -= stakeAmount;
        totalStaked -= stakeAmount;

        // Move RSR from backing to withdrawal-queue balance
        rsrBacking -= rsrAmount;

        // Create the corresponding withdrawal ticket
        uint256 index = withdrawals[account].length;
        uint256 lastAvailableAt = index > 0 ? withdrawals[account][index - 1].availableAt : 0;
        uint256 availableAt = Math.max(block.timestamp + unstakingDelay, lastAvailableAt);
        withdrawals[account].push(Withdrawal(account, rsrAmount, stakeAmount, availableAt));
        emit UnstakingStarted(index, era, account, rsrAmount, stakeAmount, availableAt);
    }

    /// Complete delayed staking for an account, up to but not including draft ID `endId`
    /// @custom:action
    function withdraw(address account, uint256 endId) external notPaused {
        IBasketHandler bh = main.basketHandler();
        require(bh.fullyCapitalized(), "RToken uncapitalized");
        require(bh.status() == CollateralStatus.SOUND, "basket defaulted");

        Withdrawal[] storage queue = withdrawals[account];
        if (endId == 0) return;
        require(endId <= queue.length, "index out-of-bounds");
        require(queue[endId - 1].availableAt <= block.timestamp, "withdrawal unavailable");

        // Call state keepers
        main.poke();
        payoutRewards();

        // Skip executed withdrawals
        uint256 start = 0;
        while (queue[start].rsrAmount == 0 && start < endId) start++;

        // Accumulate and zero executable withdrawals
        uint256 total = 0;
        uint256 i = start;
        for (; i < endId && queue[i].availableAt <= block.timestamp; i++) {
            total += queue[i].rsrAmount;
            queue[i].rsrAmount = 0;
            queue[i].stakeAmount = 0;
        }

        // Execute accumulated withdrawals
        emit UnstakingCompleted(start, i, era, account, total);
        main.rsr().safeTransfer(account, total);
    }

    /// Return the maximum valid value of endId such that withdraw(endId) should immediately work
    function endIdForWithdraw(address account) external view returns (uint256) {
        Withdrawal[] storage queue = withdrawals[account];
        uint256 i = 0;
        while (i < queue.length && queue[i].availableAt <= block.timestamp) i++;
        return i;
    }

    /// @param rsrAmount {qRSR}
    /// seizedRSR might be dust-larger than rsrAmount due to rounding.
    /// seizedRSR will _not_ be smaller than rsrAmount.
    function seizeRSR(uint256 rsrAmount) external notPaused {
        require(_msgSender() == address(main.backingManager()), "not backing manager");
        require(rsrAmount > 0, "Amount cannot be zero");
        int192 initialExchangeRate = exchangeRate();
        uint256 rewards = rsrRewards();
        uint256 rsrBalance = main.rsr().balanceOf(address(this));
        require(rsrAmount <= rsrBalance, "Cannot seize more RSR than we hold");

        // Calculate dust RSR threshold, the point at which we might as well call it a wipeout
        uint256 allStakes = totalStaked + stakeBeingWithdrawn(); // {qStRSR}
        uint256 dustRSRAmt = MIN_EXCHANGE_RATE.mulu_toUint(allStakes); // {qRSR}

        uint256 seizedRSR;
        if (rsrBalance <= rsrAmount + dustRSRAmt) {
            // Everyone's wiped out! Doom! Mayhem!
            // Zero all balances and withdrawals
            seizedRSR = rsrBalance;
            rsrBacking = 0;
            for (uint256 i = 0; i < accounts.length(); i++) {
                address account = accounts.at(i);
                delete withdrawals[account];
                balances[account] = 0;
            }
            totalStaked = 0;
            era++;
            emit AllBalancesReset(era);
        } else {
            // Remove RSR evenly from stakers, withdrawals, and the reward pool
            uint256 backingToTake = (rsrBacking * rsrAmount + (rsrBalance - 1)) / rsrBalance;
            rsrBacking -= backingToTake;
            seizedRSR = backingToTake;

            for (uint256 i = 0; i < accounts.length(); i++) {
                Withdrawal[] storage queue = withdrawals[accounts.at(i)];
                for (uint256 j = 0; j < queue.length; j++) {
                    uint256 withdrawAmt = queue[j].rsrAmount;
                    uint256 amtToTake = (withdrawAmt * rsrAmount + (rsrBalance - 1)) / rsrBalance;
                    queue[j].rsrAmount -= amtToTake;

                    seizedRSR += amtToTake;
                }
            }

            // Removing from unpaid rewards is implicit
            uint256 rewardsToTake = (rewards * rsrAmount + (rsrBalance - 1)) / rsrBalance;
            seizedRSR += rewardsToTake;

            assert(rsrAmount <= seizedRSR);
        }

        // Transfer RSR to caller
        emit ExchangeRateSet(initialExchangeRate, exchangeRate());
        main.rsr().safeTransfer(_msgSender(), seizedRSR);
    }

    /// Assign reward payouts to the staker pool
    /// State Keeper
    /// @dev do this by effecting rsrBacking and payoutLastPaid as appropriate, given the current
    /// value of rsrRewards()
    function payoutRewards() public notPaused {
        if (block.timestamp < payoutLastPaid + rewardPeriod) return;
        int192 initialExchangeRate = exchangeRate();

        uint32 numPeriods = (uint32(block.timestamp) - uint32(payoutLastPaid)) /
            uint32(rewardPeriod);

        // Paying out the ratio r, N times, equals paying out the ratio (1 - (1-r)^N) 1 time.
        int192 payoutRatio = FIX_ONE.minus(FIX_ONE.minus(rewardRatio).powu(numPeriods));
        uint256 payout = payoutRatio.mulu_toUint(rsrRewardsAtLastPayout);

        // Apply payout to RSR backing
        rsrBacking += payout;
        payoutLastPaid += numPeriods * rewardPeriod;
        rsrRewardsAtLastPayout = rsrRewards();

        emit ExchangeRateSet(initialExchangeRate, exchangeRate());
    }

    /// @return {qStRSR/qRSR} The exchange rate between StRSR and RSR
    function exchangeRate() public view returns (int192) {
        return (rsrBacking == 0 || totalStaked == 0) ? FIX_ONE : divuu(totalStaked, rsrBacking);
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
        return totalStaked;
    }

    function balanceOf(address account) external view returns (uint256) {
        return balances[account];
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

        uint256 fromBalance = balances[from];

        require(fromBalance >= amount, "ERC20: transfer amount exceeds balance");

        unchecked {
            balances[from] = fromBalance - amount;
        }

        balances[to] += amount;
        accounts.add(to);
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

    function _spendAllowance(
        address owner_,
        address spender,
        uint256 amount
    ) internal virtual {
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
    /// @return total {qStakes} Total amount of qStRSR being withdrawn
    function stakeBeingWithdrawn() internal view returns (uint256 total) {
        for (uint256 i = 0; i < accounts.length(); i++) {
            for (uint256 j = 0; j < withdrawals[accounts.at(i)].length; j++) {
                total += withdrawals[accounts.at(i)][j].stakeAmount;
            }
        }
    }

    /// @return total {qRSR} Total amount of qRSR being withdrawn
    function rsrBeingWithdrawn() internal view returns (uint256 total) {
        for (uint256 i = 0; i < accounts.length(); i++) {
            for (uint256 j = 0; j < withdrawals[accounts.at(i)].length; j++) {
                total += withdrawals[accounts.at(i)][j].rsrAmount;
            }
        }
    }

    /// @return {qRSR} The balance of RSR that this contract owns dedicated to future RSR rewards.
    function rsrRewards() internal view returns (uint256) {
        return main.rsr().balanceOf(address(this)) - rsrBacking - rsrBeingWithdrawn();
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

        address signer = ECDSAUpgradeable.recover(hash, v, r, s);
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
