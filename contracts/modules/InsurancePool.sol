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
    IERC20Upgradeable public rsrToken;

    struct RTokenRevenueEvent {
        uint256 amount;
        uint256 totalStaked;
    }

    RTokenRevenueEvent[] public revenues;
    mapping(address => uint256) public override lastIndex;
    mapping(address => uint256) public override earned;

    struct DelayedEvent {
        address account;
        uint256 amount;
        uint256 timestamp;
    }

    DelayedEvent[] public deposits;
    uint256 public depositIndex;
    DelayedEvent[] public withdrawals;
    uint256 public withdrawalIndex;

    uint256 public override totalStake;
    mapping(address => uint256) public override stake;

    modifier update(address account) {
        // Try to process up to a reasonable number of revenue events for the account.
        _catchup(account, 10000);
        _;
    }

    function initialize(address rToken_, address rsr_, address owner) external initializer {
        __Ownable_init();
        __UUPSUpgradeable_init();
        rToken = IRToken(rToken_);
        rsrToken = IERC20Upgradeable(rsr_);
        rsrToken.safeApprove(rToken_, type(uint256).max);
  
        transferOwnership(owner);
    }

    /* ========== External ========== */

    function initiateDeposit(uint256 amount) external override update(_msgSender()) {
        require(amount > 0, "Cannot stake 0");
        IERC20Upgradeable(address(rsrToken)).safeTransferFrom(_msgSender(), address(this), amount);
        deposits.push(DelayedEvent(_msgSender(), amount, block.timestamp));
        emit DepositInitiated(_msgSender(), amount);
    }

    function initiateWithdrawal(uint256 amount) public override update(_msgSender()) {
        require(amount > 0, "Cannot withdraw 0");
        withdrawals.push(DelayedEvent(_msgSender(), amount, block.timestamp));
        emit WithdrawalInitiated(_msgSender(), amount);
    }

    function balanceOf(address account) external override update(account) returns (uint256) {
        return _balanceOf(account);
    }

    function claimRevenue() external override update(_msgSender()) {
        uint256 revenue = earned[_msgSender()];
        if (revenue > 0) {
            earned[_msgSender()] = 0;
            IERC20Upgradeable(address(rToken)).safeTransfer(_msgSender(), revenue);
            emit RevenueClaimed(_msgSender(), revenue);
        }
    }

    // Escape Hatch for Dynamic Programming gone wrong.
    // Call this function if an account's lastIndex was _so_ far below that it can't be processed.
    // Anyone can call this for any account.
    function catchup(address account, uint256 index) external override {
        _catchup(account, index);
    }

    // Callable only by RToken address
    function registerRevenueEvent(uint256 amount) external override update(address(0)) {
        require(_msgSender() == address(rToken), "only RToken");

        revenues.push(RTokenRevenueEvent(amount, totalStake));
        IERC20Upgradeable(address(rToken)).safeTransferFrom(address(rToken), address(this), amount);

        emit RevenueEventSaved(revenues.length - 1, amount);
    }

    /// ================= Internal =====================

    function _balanceOf(address account) internal view returns (uint256) {
        return (rsrToken.balanceOf(address(this)) * stake[account]) / totalStake;
    }

    function _catchup(address account, uint256 numToProcess) internal {
        if (address(account) != address(0) && stake[account] > 0) {
            uint256 limit = MathUpgradeable.min(lastIndex[account] + numToProcess, revenues.length);
            for (uint256 i = lastIndex[account]; i < limit; i++) {
                earned[account] += (revenues[i].amount * stake[account]) / revenues[i].totalStaked;
            }

            lastIndex[account] = limit;
        }
        _processWithdrawals();
        _processDeposits();
    }

    function _processWithdrawals() internal {
        while (withdrawalIndex < withdrawals.length) {
            if (block.timestamp - rToken.stakingWithdrawalDelay() < withdrawals[withdrawalIndex].timestamp) {
                _settleNextWithdrawal();
            }
        }
    }

    function _processDeposits() internal {
        while (depositIndex < deposits.length) {
            if (block.timestamp - rToken.stakingDepositDelay() < deposits[withdrawalIndex].timestamp) {
                _settleNextDeposit();
            }
        }
    }

    function _settleNextWithdrawal() internal {
        DelayedEvent storage withdrawal = withdrawals[withdrawalIndex];
        uint256 amount = MathUpgradeable.min(_balanceOf(withdrawal.account), withdrawal.amount);
        stake[withdrawal.account] = stake[withdrawal.account] - amount;
        totalStake = totalStake - amount;

        emit WithdrawalCompleted(withdrawal.account, amount);
        delete withdrawals[withdrawalIndex];
        withdrawalIndex += 1;
    }

    function _settleNextDeposit() internal {
        DelayedEvent storage deposit = deposits[depositIndex];
        stake[deposit.account] += deposit.amount;
        totalStake += deposit.amount;

        emit DepositCompleted(deposit.account, deposit.amount);
        delete deposits[depositIndex];
        depositIndex += 1;
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
