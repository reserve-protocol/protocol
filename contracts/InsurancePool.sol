pragma solidity 0.8.4;

import "./zeppelin/contracts/token/ERC20/ERC20Detailed.sol";
import "./zeppelin/contracts/token/ERC20/SafeERC20.sol";

/*
 * @title InsurancePool
 * @dev This might have major problems.
 */
contract InsurancePool is IInsurancePool {
    using SafeERC20 for IERC20;

    IERC20 public immutable override RTOKEN;
    IERC20 public immutable override RSR;

    struct RevenueEvent {
        uint256 timestamp;
        uint256 totalStaked;
        uint256 revenue;
    }

    // The index of this array is a "floor"
    RevenueEvent[] public override revenueEvents;

    mapping(address => uint256) public override lastFloor;
    mapping(address => uint256) public override earned;

    ///

    uint256 private override _totalSupply;
    uint256 private override _seized;
    mapping(address => uint256) private override _balances;

    struct StakingEvent {
        uint256 timestamp;
        uint256 amount;
        address account;
    }

    StakingEvent[] public override deposits;
    StakingEvent[] public override withdrawals;
    uint256 public override withdrawalIndex;


    constructor(address rToken_, address rsr_) public {
        RTOKEN = IERC20(rToken_);
        RSR = IERC20(rsr_);
    }

    function netSupply() external view returns (uint256) {
        return _totalSupply - _seized;
    }

    function balanceOf(address account) public view update(account) returns (uint256) {
        return _balanceOf(account);
    }
    /* ========== External ========== */
    
    modifier update(address account) {
        // Scale floors for just this account to sum RevenueEvents
        if (address(account) != address(0) && _balanceOf(account) > 0) {
            for (uint256 i = lastFloor[account]; i < revenueEvents.length; i++) {
                RevenueEvent storage re = revenueEvents[i];
                earned[account] += re.revenue * _balanceOf[account] / re.totalStaked;
            }

            lastFloor[account] = revenueEvents.length;
        }

        // Process withdrawals
        uint256 ago = block.timestamp - conf.params.rsrWithdrawalDelay;
        while (withdrawalIndex < withdrawals.length) {
            if (withdrawals[withdrawalIndex].timestamp > ago) {
                break;
            }

            settleNextWithdrawal();
        }       
        
        _;
    }

    function settleNextWithdrawal() public override {
        StakingEvent storage withdrawal = withdrawals[withdrawalIndex];
        uint256 ago = block.timestamp - conf.params.rsrWithdrawalDelay;
        require(withdrawal.timestamp > ago, "too soon");

        uint256 amount = min(_balanceOf(_msgSender()), withdrawal.amount);
        _balances[withdrawal.account] = _balances[withdrawal.account] - amount;
        _totalSupply = _totalSupply - amount;

        emit WithdrawalCompleted(withdrawal.account, amount);
        delete withdrawals[withdrawalIndex];
        withdrawalIndex += 1;
    }

    function stake(uint256 amount) external override update(_msgSender()) {
        require(amount > 0, "Cannot stake 0");
        _totalSupply = _totalSupply + amount;
        _balances[_msgSender()] = _balances[_msgSender()] + amount;
        RSR.safeTransferFrom(_msgSender(), address(this), amount);
        deposits.push(StakingEvent(block.timestamp, amount, _msgSender()));
        emit Staked(_msgSender(), amount);
    }


    function initiateWithdrawal(uint256 amount) public override update(_msgSender()) {
        require(amount > 0, "Cannot withdraw 0");
        withdrawals.push(StakingEvent(block.timestamp, amount, _msgSender()));
        emit WithdrawalInitiated(_msgSender(), amount);
    }

    function claimRevenue() external override update(_msgSender()) {
        uint256 revenue = earned[_msgSender()];
        if (revenue > 0) {
            earned[_msgSender()] = 0;
            RTOKEN.safeTransfer(_msgSender(), revenue);
            emit RevenueClaimed(_msgSender(), revenue);
        }
    }

    // Call if the lastFloor was _so_ far below that he hit the block gas limit.
    // Anyone can call this for any account. 
    function climb(address account, uint256 floors) external override {
        uint256 limit = min(lastFloor[account] + floors, revenueEvents.length);
        for (uint256 i = lastFloor[account]; i < limit; i++) {
            RevenueEvent storage re = revenueEvents[i];
            earned[account] += re.revenue * _balanceOf(account) / re.totalStaked;
        }

        lastFloor[account] = limit;
    }

    /// Callable only by RToken address

    function notifyRevenue(uint256 amount) external override update(address(0)) {
        require(_msgSender() == address(RTOKEN), "only RToken can save revenue events");

        RTOKEN.safeTransferFrom(address(RTOKEN), address(this), amount);
        RevenueEvent storage next = RevenueEvent(block.timestamp, _totalSupply, amount);
        revenueEvents.push(next);

        emit RevenueEventSaved(revenueEvents.length - 1, amount);
    }

    function seizeRSR(uint256 amount) external override update(address(0)) {
        require(_msgSender() == address(RTOKEN), "only RToken can save revenue events");
        amount = min(RSR.balanceOf(address(this)), amount);
        RSR.safeTransfer(address(RTOKEN), amount);
        seized += amount;
        emit RSRSeized(amount);
        return amount
    }


    /// ================= Internal =====================
    
    function _balanceOf(address account) internal pure returns (uint256) {
        return (_totalSupply - _seized) * _balances[account] / _totalSupply;
    }


    event Staked(address indexed user, uint256 amount);
    event WithdrawalInitiated(address indexed user, uint256 amount);
    event WithdrawalCompleted(address indexed user, uint256 amount);
    event RevenueClaimed(address indexed user, uint256 reward);
    event RevenueEventSaved(uint256 index, uint256 amount);
    event RSRSeized(uint256 amount);
}


