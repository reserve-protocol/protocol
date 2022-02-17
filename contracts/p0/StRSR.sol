// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/cryptography/draft-EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/Counters.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "contracts/p0/interfaces/IAsset.sol";
import "contracts/p0/interfaces/IStRSR.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/libraries/Fixed.sol";

/*
 * @title StRSRP0
 * @notice The StRSR is where people can stake their RSR in order to provide insurance and
 * benefit from the supply expansion of an RToken.
 *
 * There's an important assymetry in the StRSR. When RSR is 3added, it must be split only
 * across non-withdrawing balances, while when RSR is seized, it must be seized from both
 * balances that are in the process of being withdrawn and those that are not.
 */
contract StRSRP0 is IStRSR, Ownable, EIP712 {
    using SafeERC20 for IERC20;
    using SafeERC20 for IERC20Metadata;
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

    IMain public main;

    // Staking Token Name and Symbol
    string private _name;
    string private _symbol;

    // Balances per account
    mapping(address => uint256) private balances;
    mapping(address => mapping(address => uint256)) private allowances;

    // List of accounts. If balances[user] > 0 then (user is in accounts)
    // TODO: still needed?
    EnumerableSet.AddressSet internal accounts;

    // {qStRSR} Total of all stRSR balances, not including pending withdrawals
    uint256 internal totalStaked;

    // {qRSR} How much RSR is allocated to backing currently-staked balances
    uint256 internal rsrBacking;

    // {seconds} The last time stRSR paid out rewards to stakers
    uint256 internal payoutLastPaid;

    // The momentary stake/unstake rate is rsrBacking/totalStaked {RSR/stRSR}
    // That rate is locked in when slow unstaking *begins*

    // Delayed Withdrawals
    struct Withdrawal {
        address account;
        uint256 rsrAmount; // How much rsr this withdrawal will be redeemed for, if none is seized
        uint256 availableAt;
    }

    // Withdrawal queues by account
    mapping(address => Withdrawal[]) public withdrawals;

    constructor(
        IMain main_,
        string memory name_,
        string memory symbol_,
        address owner_
    ) EIP712(name_, "1") {
        main = main_;
        _name = name_;
        _symbol = symbol_;
        _transferOwnership(owner_);
        payoutLastPaid = main.rewardStart();
    }

    /// Stakes an RSR `amount` on the corresponding RToken to earn yield and insure the system
    /// @param rsrAmount {qRSR}
    function stake(uint256 rsrAmount) external override {
        address account = _msgSender();
        require(rsrAmount > 0, "Cannot stake zero");
        require(!main.paused(), "main paused");

        // Process pending withdrawals
        if (main.fullyCapitalized() && main.worstCollateralStatus() == CollateralStatus.SOUND) {
            _processWithdrawals(account);
        }
        _payoutRewards();

        main.rsr().safeTransferFrom(account, address(this), rsrAmount);
        uint256 stakeAmount = (rsrAmount * totalStaked) / (rsrBacking > 0 ? rsrBacking : 1);

        // Create stRSR balance
        if (balances[account] == 0) accounts.add(account);
        balances[account] += stakeAmount;
        totalStaked += stakeAmount;

        // Move deposited RSR to backing
        rsrBacking += rsrAmount;

        emit Staked(account, rsrAmount, stakeAmount);
    }

    /// Begins a delayed unstaking for `amount` stRSR
    /// @param stakeAmount {qRSR}
    function unstake(uint256 stakeAmount) external override {
        address account = _msgSender();
        require(stakeAmount > 0, "Cannot withdraw zero");
        require(balances[account] >= stakeAmount, "Not enough balance");
        require(!main.paused(), "main paused");
        require(main.fullyCapitalized(), "RToken uncapitalized");
        require(main.worstCollateralStatus() == CollateralStatus.SOUND, "basket defaulted");

        // Process pending withdrawals
        _processWithdrawals(account);
        _payoutRewards();

        uint256 rsrAmount = (stakeAmount * rsrBacking) / totalStaked;

        // Destroy the stRSR balance
        balances[account] -= stakeAmount;
        if (balances[account] == 0) accounts.remove(account);
        totalStaked -= stakeAmount;

        // Move RSR from backing to withdrawal-queue balance
        rsrBacking -= rsrAmount;

        // Create the corresponding withdrawal ticket
        uint256 availableAt = block.timestamp + main.stRSRWithdrawalDelay();
        withdrawals[account].push(Withdrawal(account, rsrAmount, availableAt));
        emit UnstakingStarted(
            withdrawals[account].length - 1,
            account,
            rsrAmount,
            stakeAmount,
            availableAt
        );
    }

    function processWithdrawals(address account) public {
        require(!main.paused(), "main paused");
        require(main.fullyCapitalized(), "RToken uncapitalized");
        require(main.worstCollateralStatus() == CollateralStatus.SOUND, "basket defaulted");
        _processWithdrawals(account);
    }

    function notifyOfDeposit(IERC20 erc20) external override {
        require(erc20 == main.rsr(), "RSR dividends only");
        // TODO: this is pretty optional here; maybe this function's just a no-op
        _payoutRewards();
    }

    /// @param rsrAmount {qRSR}
    /// @return seizedRSR {qRSR} The actual rsrAmount seized.
    /// seizedRSR might be dust-larger than rsrAmount due to rounding.
    /// seizedRSR might be smaller than rsrAmount if we're out of RSR.
    function seizeRSR(uint256 rsrAmount) external override returns (uint256 seizedRSR) {
        require(_msgSender() == address(main), "not main");
        require(rsrAmount > 0, "Amount cannot be zero");

        uint256 rsrBalance = main.rsr().balanceOf(address(this));

        if (rsrBalance <= rsrAmount) {
            // Everyone's wiped out! Doom! Mayhem!
            // Zero all balances and withdrawals
            seizedRSR = rsrBalance;
            rsrBacking = 0;
            for (uint256 i = 0; i < accounts.length(); i++) {
                address account = accounts.at(i);
                delete withdrawals[account];
                _transfer(account, address(0), balances[account]);
            }
            totalStaked = 0;
        } else {
            // Remove RSR evenly from stakers, withdrawals, and the reward pool
            uint256 backingToTake = (rsrBacking * rsrAmount + (rsrBalance - 1)) / rsrBalance;
            rsrBacking -= backingToTake;
            seizedRSR = backingToTake;

            for (uint256 i = 0; i < accounts.length(); i++) {
                Withdrawal[] storage withdrawalQ = withdrawals[accounts.at(i)];
                for (uint256 j = 0; j < withdrawalQ.length; j++) {
                    uint256 withdrawAmt = withdrawalQ[j].rsrAmount;
                    uint256 amtToTake = (withdrawAmt * rsrAmount + (rsrBalance - 1)) / rsrBalance;
                    withdrawalQ[j].rsrAmount -= amtToTake;
                    seizedRSR += amtToTake;
                }
            }

            // Removing from unpaid rewards is implicit
            uint256 rewardsToTake = (rsrRewards() * rsrAmount + (rsrBalance - 1)) / rsrBalance;
            seizedRSR += rewardsToTake;

            assert(rsrAmount <= seizedRSR);
        }

        // Transfer RSR to caller
        main.rsr().safeTransfer(_msgSender(), seizedRSR);
        emit RSRSeized(_msgSender(), seizedRSR);
    }

    function setMain(IMain main_) external virtual override onlyOwner {
        emit MainSet(main, main_);
        main = main_;
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

    function totalSupply() external view override returns (uint256) {
        return totalStaked;
    }

    function balanceOf(address account) external view override returns (uint256) {
        return balances[account];
    }

    function transfer(address recipient, uint256 amount) external override returns (bool) {
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
        require(balances[sender] >= amount, "ERC20: transfer amount exceeds balance");
        balances[sender] -= amount;
        balances[recipient] += amount;
        accounts.add(recipient);
    }

    function allowance(address owner_, address spender) public view override returns (uint256) {
        return allowances[owner_][spender];
    }

    function approve(address spender, uint256 amount) public override returns (bool) {
        _approve(_msgSender(), spender, amount);
        return true;
    }

    function transferFrom(
        address sender,
        address recipient,
        uint256 amount
    ) public override returns (bool) {
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

    /// Assign reward payouts to the staker pool
    /// @dev do this by effecting rsrBacking and payoutLastPaid as appropriate, given the current
    /// value of rsrRewards()
    function _payoutRewards() internal {
        uint256 period = main.stRSRPayPeriod();
        if (block.timestamp < payoutLastPaid + period) return;

        uint256 numPeriods = (block.timestamp - payoutLastPaid) / period;

        // Paying out the ratio r, N times, equals paying out the ratio (1 - (1-r)^N) 1 time.
        Fix payoutRatio = FIX_ONE.minus(FIX_ONE.minus(main.stRSRPayRatio()).powu(numPeriods));
        uint256 payout = payoutRatio.mulu(rsrRewards()).floor();

        // Apply payout to RSR backing
        rsrBacking += payout;
        payoutLastPaid += numPeriods * period;

        emit RSRRewarded(payout, numPeriods);
    }

    function _processWithdrawals(address account) internal {
        // Process all pending withdrawals for the account
        Withdrawal[] storage withdrawalQ = withdrawals[account];

        for (uint256 i = 0; i < withdrawalQ.length; i++) {
            if (block.timestamp >= withdrawalQ[i].availableAt && withdrawalQ[i].rsrAmount > 0) {
                main.rsr().safeTransfer(withdrawalQ[i].account, withdrawalQ[i].rsrAmount);
                emit UnstakingCompleted(i, withdrawalQ[i].account, withdrawalQ[i].rsrAmount);
                withdrawalQ[i].rsrAmount = 0;
            }
        }
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
    ) public virtual override {
        require(block.timestamp <= deadline, "ERC20Permit: expired deadline");

        bytes32 structHash = keccak256(
            abi.encode(_PERMIT_TYPEHASH, owner_, spender, value, _useNonce(owner_), deadline)
        );

        bytes32 hash = _hashTypedDataV4(structHash);

        address signer = ECDSA.recover(hash, v, r, s);
        require(signer == owner_, "ERC20Permit: invalid signature");

        _approve(owner_, spender, value);
    }

    function nonces(address owner_) public view virtual override returns (uint256) {
        return _nonces[owner_].current();
    }

    // solhint-disable-next-line func-name-mixedcase
    function DOMAIN_SEPARATOR() external view override returns (bytes32) {
        return _domainSeparatorV4();
    }

    function _useNonce(address owner_) internal virtual returns (uint256 current) {
        Counters.Counter storage nonce = _nonces[owner_];
        current = nonce.current();
        nonce.increment();
    }

    // ==== End ERC20Permit ====
}
