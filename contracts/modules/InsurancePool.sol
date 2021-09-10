// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/MathUpgradeable.sol";
import "../interfaces/IInsurancePool.sol";
import "../interfaces/IRToken.sol";
import "../helpers/ErrorMessages.sol";

/*
 * @title InsurancePool
 * @dev The InsurancePool is where people can stake their RSR in order to provide insurance and
 * benefit from the supply expansion of an RToken. By staking they make their RSR eligible
 * to be seized by the RToken in times of default.
 *
 * This contract has pretty complicated weights tracking. This arises from the fact that deposits and
 * withdrawals are delayed and we would like to to prevent requiring users to return to process their
 * deposits/withdrawals. Any account can settle a stranger's deposit/withdrawal.
 *
 * This produces _weightsAdjustments which are used to retroactively interpret revenue events.
 */
contract InsurancePool is IInsurancePool, OwnableUpgradeable, UUPSUpgradeable {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    IRToken public rToken;
    IERC20Upgradeable public rsr;

    // ==== RSR ====

    // Weights represent percent ownership of the pool
    uint256 public override totalWeight;
    mapping(address => uint256) public override weight;

    // ==== RToken ====

    struct RevenueEvent {
        uint256 amount;
        uint256 totalWeight;
    }

    // Event log pattern
    RevenueEvent[] public revenues;

    // `last*` variables hold values from the last time the account caught up
    mapping(address => uint256) public override lastIndex;
    mapping(address => uint256) public override lastWeight;

    // Weights adjustments per Account per Revenue event (internal use)
    struct WeightAdjustment {
        uint256 amount;
        bool updated;
    }
    mapping(address => mapping(uint256 => WeightAdjustment)) internal _weightsAdjustments;

    // Holds accumulated earnings from revenues
    mapping(address => uint256) public override earned;

    // ==== Deposit and Withdrawal Queues ====

    struct Delayed {
        address account;
        uint256 amount;
        uint256 timestamp;
    }

    Delayed[] public deposits;
    uint256 public depositIndex;
    Delayed[] public withdrawals;
    uint256 public withdrawalIndex;

    /// Modifier that runs before external
    modifier update(address account) {
        // Process up to a reasonable number of revenue events for the account.
        bool caughtUp = _catchup(account, 10000);

        // Process up to a reasonable number of deposits and withdrawals if we are caught up.
        if (caughtUp) {
            caughtUp = _processWithdrawalsAndDeposits();
        }

        // Only execute the tx if we are caught up.
        if (caughtUp) {
            _;
        }
    }

    function initialize(address rToken_, address rsr_) external initializer {
        __Ownable_init();
        __UUPSUpgradeable_init();
        rToken = IRToken(rToken_);
        rsr = IERC20Upgradeable(rsr_);
        rsr.safeApprove(rToken_, type(uint256).max);
    }

    function balanceOf(address account) external view override returns (uint256) {
        return _balanceOf(account);
    }

    /* ========== External ========== */

    function stake(uint256 amount) external override update(_msgSender()) {
        if (amount == 0) {
            revert CannotStakeZero();
        }
        IERC20Upgradeable(address(rsr)).safeTransferFrom(_msgSender(), address(this), amount);
        deposits.push(Delayed(_msgSender(), amount, block.timestamp));
        emit DepositInitiated(_msgSender(), amount);
    }

    function unstake(uint256 amount) public override update(_msgSender()) {
        if (amount == 0) {
            revert CannotWithdrawZero();
        }
        if (_balanceOf(_msgSender()) < amount) {
            revert NotEnoughBalance();
        }
        withdrawals.push(Delayed(_msgSender(), amount, block.timestamp));
        emit WithdrawalInitiated(_msgSender(), amount);
    }

    function claimRevenue() external override update(_msgSender()) {
        _claimRevenue();
    }

    // Escape Hatch for Dynamic Programming gone wrong.
    // Call this function if an account's lastIndex was _so_ far below that it can't be processed.
    // Anyone can call this for any account.
    function catchup(address account, uint256 numToProcess) external override returns (bool) {
        return _catchup(account, numToProcess);
    }

    /// Anyone can call this function.
    /// Processes withdrawals and deposits that can be settled.
    function processWithdrawalsAndDeposits() external override returns (bool) {
        return _processWithdrawalsAndDeposits();
    }

    /// Callable only by RToken address
    function makeInsurancePayment(uint256 amount) external override update(address(0)) {
        if (_msgSender() != address(rToken)) {
            revert OnlyRToken();
        }
        IERC20Upgradeable(address(rToken)).safeTransferFrom(address(rToken), address(this), amount);

        revenues.push(RevenueEvent(amount, totalWeight));
        emit RevenueEventSaved(revenues.length - 1, amount);

        // Need to update allowance - make RToken callers pay the cost.
        rsr.safeIncreaseAllowance(address(rToken), type(uint256).max - rsr.allowance(address(this), address(rToken)));
    }

    /// ================= Internal =====================

    function _claimRevenue() internal {
        uint256 revenue = earned[_msgSender()];
        if (revenue > 0) {
            earned[_msgSender()] = 0;
            IERC20Upgradeable(address(rToken)).safeTransfer(_msgSender(), revenue);
            emit RevenueClaimed(_msgSender(), revenue);
        }
    }

    function _balanceOf(address account) internal view returns (uint256) {
        if (totalWeight == 0) {
            return 0;
        }
        return (rsr.balanceOf(address(this)) * weight[account]) / totalWeight;
    }

    function _catchup(address account, uint256 numToProcess) internal returns (bool) {
        if (address(account) != address(0)) {
            uint256 weightToUse = lastWeight[account];
            uint256 endIndex = MathUpgradeable.min(lastIndex[account] + numToProcess, revenues.length);

            for (uint256 i = lastIndex[account]; i < endIndex; i++) {
                // Check if weight adjustments occured, use new weight from that point
                WeightAdjustment memory _adj = _weightsAdjustments[account][i];
                if (_adj.updated) {
                    weightToUse = _adj.amount;
                }

                // Increment earned revenues
                earned[account] += (revenues[i].amount * weightToUse) / revenues[i].totalWeight;
            }

            // Update values for next catchup process
            lastIndex[account] = endIndex;
            lastWeight[account] = weight[account];

            // Is there more work to do?
            if (lastIndex[account] != revenues.length) {
                emit AccountPendingUpdate(account);
                return false;
            }
        }
        return true;
    }

    function _processWithdrawalsAndDeposits() internal returns (bool) {
        // Withdrawals
        uint256 stakingWithdrawalDelay = rToken.stakingWithdrawalDelay();
        uint256 endIndex = withdrawalIndex + 1000; // TODO: Check 1000 is safe
        while (
            withdrawalIndex < withdrawals.length &&
            withdrawalIndex < endIndex &&
            block.timestamp > withdrawals[withdrawalIndex].timestamp + stakingWithdrawalDelay
        ) {
            _settleNextWithdrawal();
        }

        // Deposits
        uint256 stakingDepositDelay = rToken.stakingDepositDelay();
        endIndex = depositIndex + (endIndex - withdrawalIndex);
        while (
            depositIndex < deposits.length &&
            depositIndex < endIndex &&
            block.timestamp > deposits[depositIndex].timestamp + stakingDepositDelay
        ) {
            _settleNextDeposit();
        }

        // Are we done?
        return
            (withdrawalIndex == withdrawals.length ||
                block.timestamp < withdrawals[withdrawalIndex].timestamp + stakingWithdrawalDelay) &&
            (depositIndex == deposits.length ||
                block.timestamp < deposits[depositIndex].timestamp + stakingDepositDelay);
    }

    function _settleNextWithdrawal() internal {
        Delayed storage withdrawal = withdrawals[withdrawalIndex];
        uint256 amount = MathUpgradeable.min(_balanceOf(withdrawal.account), withdrawal.amount);
        if (amount > 0) {
            // Adjust weights
            uint256 equivalentWeight = (amount * totalWeight) / rsr.balanceOf(address(this));
            weight[withdrawal.account] = weight[withdrawal.account] - equivalentWeight;
            totalWeight = totalWeight - equivalentWeight;

            // Register adjustment
            WeightAdjustment storage _adj = _weightsAdjustments[withdrawal.account][revenues.length];
            _adj.amount = weight[withdrawal.account];
            _adj.updated = true;

            rsr.safeTransfer(withdrawal.account, amount);
        }
        // Exit with earned RToken
        _claimRevenue();

        emit WithdrawalCompleted(withdrawal.account, amount);
        delete withdrawals[withdrawalIndex];
        withdrawalIndex += 1;
    }

    function _settleNextDeposit() internal {
        Delayed storage deposit = deposits[depositIndex];
        weight[deposit.account] += deposit.amount;
        totalWeight += deposit.amount;

        // Register adjustment
        WeightAdjustment storage _adj = _weightsAdjustments[deposit.account][revenues.length];
        _adj.amount = weight[deposit.account];
        _adj.updated = true;

        emit DepositCompleted(deposit.account, deposit.amount);
        delete deposits[depositIndex];
        depositIndex += 1;
    }

    /* solhint-disable no-empty-blocks */
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
