// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;


import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/Context.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

import "../interfaces/IInsurancePool.sol";
import "../interfaces/IRToken.sol";

/*
 * @title InsurancePool
 * @dev The InsurancePool is where people can stake their RSR in order to provide insurance and
 * benefit from the revenue stream from an RToken. By staking they make their RSR eligible
 * to be used in the event of recapitalization.
 */
contract InsurancePoolFacet is Context, IInsurancePool {
    using SafeERC20 for IERC20;
    using Token for Token.Info;

    AppStorage internal s;

    modifier update(address account) {
        // Scale floors for just this account to sum RevenueEvents
        if (address(account) != address(0) && s.rsrStakeBalances[account] > 0) {
            climb(account, r.revenueEvents.length - s.lastFloor[account]);
        }

        // Process withdrawals
        bool success = true;
        while (success && withdrawalIndex < withdrawals.length) {
            success = _trySettleNextWithdrawal();
        }

        // Process deposits
        success = true;
        while (success && depositIndex < deposits.length) {
            success = _trySettleNextDeposit();
        }

        _;
    }

    /* ========== Public ========== */

    // Call if the lastFloor was _so_ far below that he hit the block gas limit.
    // Anyone can call this for any account.
    function climb(address account, uint256 floors) public override {
        for (uint256 i = lastFloor[account]; i < lastFloor[account] + floors; i++) {
            RevenueEvent storage re = s.revenueEvents[i];
            s.rTokenEarned[account] += (re.amount * _balanceOf(account) / re.totalStaked;
        }

        lastFloor[account] += floors;
    }

    function initiateWithdrawal(uint256 amount) public override update(_msgSender()) {
        require(amount > 0, "Cannot withdraw 0");
        s.withdrawals.push(StakingEvent(_msgSender(), block.timestamp, amount));
        emit WithdrawalInitiated(_msgSender(), block.timestamp, amount);
    }

    /* ========== External ========== */

    function stake(uint256 amount) external override update(_msgSender()) {
        require(amount > 0, "Cannot stake 0");
        deposits.push(StakingEvent(_msgSender(), block.timestamp, amount));
        emit DepositInitiated(_msgSender(), block.timestamp, amount);
    }


    function exit() external override {
        initiateWithdrawal(_balanceOf(_msgSender()));
    }


    function notifyRevenue(uint256 amount) external override update(address(0)) {
        require(_msgSender() == address(this), "only self can save revenue events");

        RevenueEvent memory next = RevenueEvent(amount, s.rsrStaked);
        s.revenueEvents.push(next);
        emit RevenueEventSaved(s.revenueEvents.length - 1, amount);
    }

    /// ================= Internal =====================

    function _balanceOf(address account) internal view returns (uint256) {
        return (s.rsr.getBalance() * s.rsrStakeBalances[account]) / s.rsrStaked;
    }

    function _trySettleNextDeposit() internal returns (bool) {
        StakingEvent storage deposit = deposits[depositIndex];
        if (block.timestamp - s.stakingDepositDelay < deposit.timestamp) {
            return false;
        }

        s.rsrStakeBalances[deposit.account] += deposit.amount;
        s.rsrStaked += deposit.amount;

        emit DepositCompleted(deposit.account, deposit.amount);
        delete deposits[depositIndex];
        depositIndex += 1;
        return true;
    }

    function _trySettleNextWithdrawal() internal returns (bool) {
        StakingEvent storage w = withdrawals[withdrawalIndex];
        if (block.timestamp - s.stakingWithdrawalDelay < w.timestamp) {
            return false;
        }

        uint256 amount = Math.min(_balanceOf(w.account), w.amount);
        s.rsrStakeBalances[w.account] = s.rsrStakeBalances[w.account] - amount;
        s.rsrStaked = s.rsrStaked - amount;

        IERC20(address(this)).safeTransfer(w.account, s.rTokenEarned[w.account]);
        r.rTokenEarned[w.account] = 0;

        emit WithdrawalCompleted(w.account, amount);
        delete withdrawals[withdrawalIndex];
        withdrawalIndex += 1;
        return true;
    }
}
