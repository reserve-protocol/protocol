// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/MathUpgradeable.sol";
import "../interfaces/IInsurancePool.sol";
import "../interfaces/IRToken.sol";

/*
 * @title InsurancePool
 * @dev The InsurancePool is where people can stake their RSR in order to provide insurance and
 * benefit from the revenue stream from an RToken. By staking they make their RSR eligible
 * to be used in the event of recapitalization.
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
        uint256 timestamp;
    }

    // Event log pattern
    RevenueEvent[] public revenues;

    // `last*` variables hold values from the last time the account caught up
    mapping(address => uint256) public override lastTimestamp;
    mapping(address => uint256) public override lastIndex;
    mapping(address => uint256) public override lastWeight;

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

    modifier update(address account) {
        // Try to process up to a reasonable number of revenue events for the account.
        _catchup(account, 10000);
        _;
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
        require(amount > 0, "Cannot stake 0");
        IERC20Upgradeable(address(rsr)).safeTransferFrom(_msgSender(), address(this), amount);
        deposits.push(Delayed(_msgSender(), amount, block.timestamp));
        emit DepositInitiated(_msgSender(), amount);
    }

    function unstake(uint256 amount) public override update(_msgSender()) {
        require(amount > 0, "Cannot withdraw 0");
        require(_balanceOf(_msgSender()) >= amount, "Not enough balance");
        withdrawals.push(Delayed(_msgSender(), amount, block.timestamp));
        emit WithdrawalInitiated(_msgSender(), amount);
    }

    function claimRevenue() external override update(_msgSender()) {
        _claimRevenue();
    }

    // Escape Hatch for Dynamic Programming gone wrong.
    // Call this function if an account's lastIndex was _so_ far below that it can't be processed.
    // Anyone can call this for any account.
    function catchup(address account, uint256 index) external override {
        _catchup(account, index);
    }

    // Callable only by RToken address
    function makeInsurancePayment(uint256 amount) external override update(address(0)) {
        require(_msgSender() == address(rToken), "Only RToken");

        IERC20Upgradeable(address(rToken)).safeTransferFrom(address(rToken), address(this), amount);
        revenues.push(RevenueEvent(amount, totalWeight, block.timestamp));
        emit RevenueEventSaved(revenues.length - 1, amount);

        // Nice to refresh this, and best to make RToken callers pay the cost.
        rsr.safeIncreaseAllowance(
            address(rToken),
            type(uint256).max - rsr.allowance(address(this), address(rToken))
        );
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

    function _catchup(address account, uint256 numToProcess) internal {
        uint256 stakingDelay = rToken.stakingDelay();

        if (address(account) != address(0)) {
            uint256 t; uint256 lastTime;
            uint256 endIndex = MathUpgradeable.min(lastIndex[account] + numToProcess, revenues.length);

            for (uint256 i = lastIndex[account]; i < endIndex; i++) {
                t = revenues[i].timestamp;
                lastTime = lastTimestamp[account];

                // If they couldn't have withdrawn/deposited since last _catchup, use `weight`.
                // Else If they could have withdrawn/deposited since last _catchup, use `lastWeight`.
                if (t > lastTime && t <= lastTime + stakingDelay) {
                    earned[account] += (revenues[i].amount * weight[account]) / revenues[i].totalWeight;
                } else if (t > lastTime && t > lastTime + stakingDelay) {
                    earned[account] += (revenues[i].amount * lastWeight[account]) / revenues[i].totalWeight;
                }
            }
            lastIndex[account] = endIndex;
            lastWeight[account] = weight[account];
            lastTimestamp[account] = block.timestamp;
        }

        _processWithdrawals(stakingDelay);
        _processDeposits(stakingDelay);
    }

    function _processWithdrawals(uint256 stakingDelay) internal {
        while (
            withdrawalIndex < withdrawals.length &&
            block.timestamp - stakingDelay > withdrawals[withdrawalIndex].timestamp
        ) {
            _settleNextWithdrawal();
        }
    }

    function _processDeposits(uint256 stakingDelay) internal {
        while (
            depositIndex < deposits.length &&
            block.timestamp - stakingDelay > deposits[depositIndex].timestamp
        ) {
            _settleNextDeposit();
        }
    }

    function _settleNextWithdrawal() internal {
        Delayed storage withdrawal = withdrawals[withdrawalIndex];
        uint256 amount = MathUpgradeable.min(_balanceOf(withdrawal.account), withdrawal.amount);
        if (amount > 0) {
            // Adjust weights
            uint256 equivalentWeight = (amount * totalWeight) / rsr.balanceOf(address(this));
            weight[withdrawal.account] = weight[withdrawal.account] - equivalentWeight;
            totalWeight = totalWeight - equivalentWeight;

            rsr.safeTransfer(withdrawal.account, amount);

            // Exit with earned RToken
            _claimRevenue();
        }

        emit WithdrawalCompleted(withdrawal.account, amount);
        delete withdrawals[withdrawalIndex];
        withdrawalIndex += 1;
    }

    function _settleNextDeposit() internal {
        Delayed storage deposit = deposits[depositIndex];
        weight[deposit.account] += deposit.amount;
        totalWeight += deposit.amount;

        emit DepositCompleted(deposit.account, deposit.amount);
        delete deposits[depositIndex];
        depositIndex += 1;
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
