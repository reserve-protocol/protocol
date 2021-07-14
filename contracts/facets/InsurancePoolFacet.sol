// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;


import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/Context.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

import "../interfaces/IInsurancePool.sol";
import "../interfaces/IIssuance.sol";
import "../libraries/Storage.sol";


/*
 * @title InsurancePool
 * @dev The InsurancePool is where people can stake their RSR in order to provide insurance and
 * benefit from the revenue stream from an RToken. By staking they make their RSR eligible
 * to be used in the event of recapitalization.
 */
contract InsurancePoolFacet is Context, IInsurancePool {
    using DiamondStorage for DiamondStorage.Info;
    using SafeERC20 for IERC20;
    using Token for Token.Info;

    DiamondStorage.Info internal ds;

    struct RevenueEvent {
       uint256 amount;
       uint256 totalStaked;
    }

    struct StakingEvent {
        address account;
        uint256 timestamp;
        uint256 amount;
    }

    struct InsurancePoolStorage {
        RevenueEvent[] revenueEvents;
        StakingEvent[] deposits;
        StakingEvent[] withdrawals;
        mapping(address => uint256) lastFloor;
        mapping(address => uint256) earned; // in RToken
        mapping(address => uint256) balances; // in RSR
        uint256 total;
        uint256 depositIndex;
        uint256 withdrawalIndex;

        /// ==== Governance Params ====
        /// RSR staking deposit delay (s)
        /// e.g. 2_592_000 => Newly staked RSR tokens take 1 month to enter the insurance pool
        uint256 stakingDepositDelay;
        /// RSR staking withdrawal delay (s)
        /// e.g. 2_592_000 => Currently staking RSR tokens take 1 month to withdraw
        uint256 stakingWithdrawalDelay;
    }

    modifier update(address account) {
        InsurancePoolStorage storage s = ds.insurancePoolStorage();
        // Scale floors for just this account to sum RevenueEvents
        if (address(account) != address(0) && s.balances[account] > 0) {
            climb(account, s.revenueEvents.length - s.lastFloor[account]);
        }

        // Process withdrawals
        bool success = true;
        while (success && withdrawalIndex < s.withdrawals.length) {
            success = _trySettleNextWithdrawal(s);
        }

        // Process deposits
        success = true;
        while (success && depositIndex < s.deposits.length) {
            success = _trySettleNextDeposit(s);
        }

        _;
    }

    /* ========== Public ========== */



    // Call if the lastFloor was _so_ far below that he hit the block gas limit.
    // Anyone can call this for any account.
    function climb(address account, uint256 floors) public override {
        InsurancePoolStorage storage s = ds.insurancePoolStorage();
        for (uint256 i = lastFloor[account]; i < s.lastFloor[account] + floors; i++) {
            RevenueEvent storage re = s.revenueEvents[i];
            s.earned[account] += (re.amount * _balanceOf(account) / re.totalStaked;
        }

        s.lastFloor[account] += floors;
    }

    function initiateWithdrawal(uint256 amount) public override update(_msgSender()) {
        require(amount > 0, "Cannot withdraw 0");
        ds.insurancePoolStorage().withdrawals.push(StakingEvent(_msgSender(), block.timestamp, amount));
        emit WithdrawalInitiated(_msgSender(), block.timestamp, amount);
    }

    /* ========== External ========== */

    function balanceOf(address account) external view returns (uint256) {
        InsurancePoolStorage storage s = ds.insurancePoolStorage();
        return _balanceOf(s, account);
    }

    function stake(uint256 amount) external override update(_msgSender()) {
        require(amount > 0, "Cannot stake 0");
        ds.insurancePoolStorage().deposits.push(StakingEvent(_msgSender(), block.timestamp, amount));
        emit DepositInitiated(_msgSender(), block.timestamp, amount);
    }


    function exit() external override {
        InsurancePoolStorage storage s = ds.insurancePoolStorage();
        initiateWithdrawal(_balanceOf(s, _msgSender()));
    }


    function notifyRevenue(uint256 amount) external override update(address(0)) {
        require(_msgSender() == address(this), "only self can save revenue events");

        RevenueEvent memory next = RevenueEvent(amount, s.total);
        ds.insurancePoolStorage().revenueEvents.push(next);
        emit RevenueEventSaved(ds.insurancePoolStorage().revenueEvents.length - 1, amount);
    }

    function claimRevenue(address account) external override update(account) {
        IERC20(address(this)).safeTransfer(w.account, s.earned[w.account]);
        s.earned[w.account] = 0;        
    }

    /// ================= Internal =====================

    function _balanceOf(InsurancePoolStorage storage s, address account) internal view returns (uint256) {
        return (s.rsr.getBalance() * s.balances[account]) / s.total;
    }

    function _trySettleNextDeposit(InsurancePoolStorage storage s) internal returns (bool) {
        StakingEvent storage deposit = s.deposits[depositIndex];
        if (block.timestamp - s.stakingDepositDelay < deposit.timestamp) {
            return false;
        }

        s.balances[deposit.account] += deposit.amount;
        s.total += deposit.amount;

        emit DepositCompleted(deposit.account, deposit.amount);
        delete s.deposits[depositIndex];
        depositIndex += 1;
        return true;
    }

    function _trySettleNextWithdrawal(InsurancePoolStorage storage s) internal returns (bool) {
        StakingEvent storage w = s.withdrawals[withdrawalIndex];
        if (block.timestamp - s.stakingWithdrawalDelay < w.timestamp) {
            return false;
        }

        uint256 amount = Math.min(_balanceOf(s, w.account), w.amount);
        s.balances[w.account] = s.balances[w.account] - amount;
        s.total = s.total - amount;

        IERC20(address(this)).safeTransfer(w.account, s.earned[w.account]);
        s.earned[w.account] = 0;

        emit WithdrawalCompleted(w.account, amount);
        delete s.withdrawals[withdrawalIndex];
        withdrawalIndex += 1;
        return true;
    }
}
