pragma solidity 0.8.4;

import "./zeppelin/contracts/token/ERC20/ERC20Detailed.sol";
import "./zeppelin/contracts/token/ERC20/SafeERC20.sol";

/*
 * @title InsurancePool
 * @dev This might have major problems.
 */
contract InsurancePool is IInsurancePool {
    using SafeERC20 for IERC20;

    IERC20 public immutable override rToken;
    IERC20 public immutable override stakingToken;

    struct RevenueEvent {
        uint256 timestamp;
        uint256 totalStaked;
        uint256 revenue;
    }

    // The index of this array is a "floor"
    RevenueEvent[] public override revenueEvents;

    mapping(address => uint256) public override lastFloor;
    mapping(address => uint256) public override earned;

    uint256 private override _totalSupply;
    mapping(address => uint256) private override _balances;

    struct StakingEvent {
        uint256 timestamp;
        uint256 amount;
    }

    mapping(address => StakingEvent[]) public override deposits;
    mapping(address => StakingEvent[]) public override withdrawals;


    constructor(address _rToken, address _stakingToken) public {
        rToken = IERC20(_rToken);
        stakingToken = IERC20(_stakingToken);
    }

    function totalSupply() external view returns (uint256) {
        return _totalSupply;
    }

    function balanceOf(address account) external view update(account) returns (uint256) {
        return _balances[account];
    }

    /* ========== External ========== */
    
    // TODO: This might be fundamentally broken...
    modifier update(address account) {
        // Process withdrawals
        uint256 ago = block.timestamp - conf.params.rsrWithdrawalDelay;
        while (withdrawals[account].length > 0) {
            if (withdrawals[account][0].timestamp > ago) {
                break;
            }

            settleTopWithdrawal(account);
        }       
        
        // Scale floors to sum RevenueEvents
        if (_balances[account] > 0) {
            for (uint256 i = lastFloor[account]; i < revenueEvents.length; i++) {
                RevenueEvent storage re = revenueEvents[i];
                earned[account] += re.revenue * _balances[account] / re.totalStaked;
            }

            lastFloor[account] = revenueEvents.length;
        }

        _;
    }

    function amountBeingWithdrawn(address account) public view override returns(uint256) {
        uint256 total;
        for (uint32 i = 0; i < withdrawals[account].length; i++) {
            total += withdrawals[account][i].amount;
        }
        return total;
    }

    function settleTopWithdrawal(address account) public override {
        StakingEvent storage withdrawal = withdrawals[account][0];
        uint256 amount = min(_balances[account], withdrawal.amount);

        _balances[account] = _balances[account] - amount;
        _totalSupply = _totalSupply - amount;

        // Shift elements of withdrawals array
        delete withdrawal;
        for (uint32 i = 1; i < withdrawals[account].length; i++) {
            withdrawals[account][i-1] = withdrawals[account][i];
            withdrawals[account].length -= 1;
        }
    }

    function stake(uint256 amount) external override update(_msgSender()) {
        require(amount > 0, "Cannot stake 0");
        _totalSupply = _totalSupply + amount;
        _balances[_msgSender()] = _balances[_msgSender()] + amount;
        stakingToken.safeTransferFrom(_msgSender(), address(this), amount);
        deposits[_msgSender()].push(StakingEvent(block.timestamp, amount));
        emit Staked(_msgSender(), amount);
    }


    function initiateWithdrawal(uint256 amount) public override update(_msgSender()) {
        uint256 beingWithdrawn = amountBeingWithdrawn(_msgSender());
        require(amount > 0, "Cannot withdraw 0");
        require(amount < _balances[_msgSender()] - beingWithdrawn, "withdrawing too mucch");
        withdrawals[_msgSender()].push(StakingEvent(block.timestamp, amount));
        emit WithdrawalInitiated(_msgSender(), amount);
    }

    function claimRevenue() external override update(_msgSender()) {
        uint256 revenue = earned[_msgSender()];
        if (revenue > 0) {
            earned[_msgSender()] = 0;
            rToken.safeTransfer(_msgSender(), revenue);
            emit RevenueClaimed(_msgSender(), revenue);
        }
    }

    function completeExit() external override {
        // TODO: require(withdrawals[_msgSender()])
        initiateWithdrawal(_balances[_msgSender()]);
        claimRevenue();
    }

    // Call if the lastFloor was _so_ far below that he hit the block gas limit.
    // Anyone can call this for any account. 
    function climb(address account, uint256 floors) external override {
        uint256 limit = min(lastFloor[account] + floors, revenueEvents.length);
        for (uint256 i = lastFloor[account]; i < limit; i++) {
            RevenueEvent storage re = revenueEvents[i];
            earned[account] += re.revenue * _balances[account] / re.totalStaked;
        }

        lastFloor[account] = limit;
    }

    /// Callable only by RToken address

    function saveRevenueEvent(uint256 amount) external override {
        require(_msgSender() == address(rToken), "only RToken can save revenue events");

        RevenueEvent storage next = RevenueEvent(block.timestamp, _totalSupply, amount);
        revenueEvents.push(next);

        emit RevenueEventSaved(revenueEvents.length-1, amount);
    }




    event Staked(address indexed user, uint256 amount);
    event WithdrawalInitiated(address indexed user, uint256 amount);
    event WithdrawalCompleted(address indexed user, uint256 amount);
    event RevenueClaimed(address indexed user, uint256 reward);
    event RevenueEventSaved(uint256 index, uint256 amount)
}


