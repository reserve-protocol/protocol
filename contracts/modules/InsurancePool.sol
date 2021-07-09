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
contract InsurancePool is Context, IInsurancePool {
    using SafeERC20 for IERC20;

    IRToken public rToken;
    IERC20 public rsrToken;

    struct RevenueEvent {
        bool isRSR; // Two options, either RToken or RSR
        uint256 amount;
        uint256 totalStaked;
    }

    // The index of this array is a "floor"
    RevenueEvent[] public revenueEvents;
    mapping(address => uint256) public override lastFloor;
    mapping(address => uint256) public rTokenRevenues;

    ///

    uint256 private _seized;
    uint256 private _totalSupply;
    mapping(address => uint256) private _balances;

    struct StakingEvent {
        address account;
        uint256 timestamp;
        uint256 amount;
    }

    StakingEvent[] public deposits;
    uint256 public depositIndex;
    StakingEvent[] public withdrawals;
    uint256 public withdrawalIndex;

    constructor(address rToken_, address rsr_) {
        rToken = IRToken(rToken_);
        rsrToken = IERC20(rsr_);
    }

    modifier update(address account) {
        // TODO: Think hard about ordering

        // Scale floors for just this account to sum RevenueEvents
        if (address(account) != address(0) && _balanceOf(account) > 0) {
            for (uint256 i = lastFloor[account]; i < revenueEvents.length; i++) {
                RevenueEvent storage re = revenueEvents[i];
                if (re.isRSR) {
                    _balances[account] += (re.amount * _balanceOf(account)) / re.totalStaked;
                } else {
                    rTokenRevenues[account] += (re.amount * _balanceOf(account)) / re.totalStaked;
                }
            }

            lastFloor[account] = revenueEvents.length;
        }

        // Process withdrawals
        bool success = true;
        while (success && withdrawalIndex < withdrawals.length) {
            success = trySettleNextWithdrawal();
        }

        // Process deposits
        success = true;
        while (success && depositIndex < deposits.length) {
            success = trySettleNextDeposit();
        }

        _;
    }

    /* ========== External ========== */
    
    function initiateWithdrawal(uint256 amount) public override update(_msgSender()) {
        require(amount > 0, "Cannot withdraw 0");
        withdrawals.push(StakingEvent(_msgSender(), block.timestamp, amount));
        emit WithdrawalInitiated(_msgSender(), block.timestamp, amount);
    }
    
    function trySettleNextWithdrawal() public override returns (bool) {
        StakingEvent storage withdrawal = withdrawals[withdrawalIndex];
        if (block.timestamp - rToken.stakingWithdrawalDelay() < withdrawal.timestamp) {
            return false;
        }

        uint256 amount = Math.min(_balanceOf(withdrawal.account), withdrawal.amount);
        _balances[withdrawal.account] = _balances[withdrawal.account] - amount;
        _totalSupply = _totalSupply - amount;

        emit WithdrawalCompleted(withdrawal.account, amount);
        delete withdrawals[withdrawalIndex];
        withdrawalIndex += 1;
        return true;
    }

    function trySettleNextDeposit() public override returns (bool) {
        StakingEvent storage deposit = deposits[depositIndex];
        if (block.timestamp - rToken.stakingDepositDelay() < deposit.timestamp) {
            return false;
        }

        _balances[deposit.account] += deposit.amount;
        _totalSupply += deposit.amount;

        emit DepositCompleted(deposit.account, deposit.amount);
        delete deposits[depositIndex];
        depositIndex += 1;
        return true;
    }

    function totalSupply() external override update(address(0)) returns (uint256) {
        return _totalSupply - _seized;
    }

    function balanceOf(address account) external override update(account) returns (uint256) {
        return _balanceOf(account);
    }

    // TODO: Implement earned
    function earned(address account) external view returns (uint256) {}


    function stake(uint256 amount) external override update(_msgSender()) {
        require(amount > 0, "Cannot stake 0");
        IERC20(address(rsrToken)).safeTransferFrom(_msgSender(), address(this), amount);
        deposits.push(StakingEvent(_msgSender(), block.timestamp, amount));
        emit DepositInitiated(_msgSender(), block.timestamp, amount);
    }

    function claimRevenue() external override update(_msgSender()) {
        uint256 revenue = rTokenRevenues[_msgSender()];
        if (revenue > 0) {
            rTokenRevenues[_msgSender()] = 0;
            IERC20(address(rToken)).safeTransfer(_msgSender(), revenue);
            emit RevenueClaimed(_msgSender(), revenue);
        }
    }

    // Call if the lastFloor was _so_ far below that he hit the block gas limit.
    // Anyone can call this for any account.
    function climb(address account, uint256 floors) external override {
        uint256 limit = Math.min(lastFloor[account] + floors, revenueEvents.length);
        for (uint256 i = lastFloor[account]; i < limit; i++) {
            RevenueEvent storage re = revenueEvents[i];
            rTokenRevenues[account] += (re.amount * _balanceOf(account)) / re.totalStaked;
        }

        lastFloor[account] = limit;
    }

    /// Callable only by RToken address

    function notifyRevenue(bool isRSR, uint256 amount) external override update(address(0)) {
        require(_msgSender() == address(rToken), "only RToken can save revenue events");

        RevenueEvent memory next = RevenueEvent(isRSR, amount, _totalSupply);
        revenueEvents.push(next);
        if (isRSR) {
            IERC20(address(rsrToken)).safeTransferFrom(address(rToken), address(this), amount);
            _totalSupply += amount;
        } else {
            IERC20(address(rToken)).safeTransferFrom(address(rToken), address(this), amount);
        }

        emit RevenueEventSaved(isRSR, revenueEvents.length - 1, amount);
    }

    function seizeRSR(uint256 amount) external override update(address(0)) returns (uint256) {
        require(_msgSender() == address(rToken), "only RToken can seize RSR");
        amount = Math.min(rsrToken.balanceOf(address(this)), amount);
        IERC20(address(rsrToken)).safeTransfer(address(rToken), amount);
        _seized += amount;
        emit RSRSeized(amount);
        return amount;
    }

    /// ================= Internal =====================

    function _balanceOf(address account) internal view returns (uint256) {
        return ((_totalSupply - _seized) * _balances[account]) / _totalSupply;
    }
}
