pragma solidity 0.8.4;

import "./zeppelin/contracts/token/ERC20/ERC20Detailed.sol";
import "./zeppelin/contracts/token/ERC20/SafeERC20.sol";

contract InsurancePool is IInsurancePool {
    using SafeERC20 for IERC20;

    IERC20 public immutable override rToken;
    IERC20 public immutable override stakingToken;

    struct RevenueEvent {
        uint256 totalStaked;
        uint256 revenue;
    }

    // The index of this array is a "floor"
    RevenueEvent[] public override revenueEvents;
    bool public override hasUpdated = false;

    mapping(address => uint256) public override lastFloor;
    mapping(address => uint256) public override earned;


    uint256 private override _totalSupply;
    mapping(address => uint256) private override _balances;


    constructor(address _rToken, address _stakingToken) public {
        rToken = IERC20(_rToken);
        stakingToken = IERC20(_stakingToken);
    }

    /* ========== VIEWS ========== */

    function totalSupply() external view returns (uint256) {
        return _totalSupply;
    }

    function balanceOf(address account) external view returns (uint256) {
        return _balances[account];
    }

    /* ========== MUTATIVE FUNCTIONS ========== */

    function stake(uint256 amount) external override update(_msgSender()) {
        require(amount > 0, "Cannot stake 0");
        _totalSupply = _totalSupply + amount;
        _balances[_msgSender()] = _balances[_msgSender()] + amount;
        stakingToken.safeTransferFrom(_msgSender(), address(this), amount);
        emit Staked(_msgSender(), amount);
    }

    function unstake(uint256 amount) public override update(_msgSender()) {
        require(amount > 0, "Cannot unstake 0");
        _totalSupply = _totalSupply - amount;
        _balances[_msgSender()] = _balances[_msgSender()] - amount;
        stakingToken.safeTransfer(_msgSender(), amount);
        emit Withdrawn(_msgSender(), amount);
    }

    function claimRevenue() external override update(_msgSender()) {
        uint256 revenue = earned[_msgSender()];
        if (revenue > 0) {
            earned[_msgSender()] = 0;
            rToken.safeTransfer(_msgSender(), revenue);
            emit RevenueClaimed(_msgSender(), revenue);
        }
    }

    function exit() external override {
        unstake(_balances[_msgSender()]);
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
        hasUpdated = true;
    }

    /// Callable only by RToken address

    function saveRevenueEvent(uint256 amount) external override {
        require(_msgSender() == address(rToken), "only RToken can save revenue events");

        // If nothing has changed in terms of stakers, we can combine events to save on gas.
        if (!hasUpdated && revenueEvents.length > 0) {
            RevenueEvent storage last = revenueEvents[revenueEvents.length-1];
            last.totalStaked = _totalSupply;
            last.revenue += amount;
        } else {
            RevenueEvent storage next = RevenueEvent(_totalSupply, amount);
            revenueEvents.push(next);
        }

        hasUpdated = false;
        emit RevenueEventSaved(revenueEvents.length-1, amount);
    }

    /* ========== MODIFIERS ========== */

    modifier update(address account) {
        hasUpdated = true;
        if (_balances[account] > 0) {
            for (uint256 i = lastFloor[account]; i < revenueEvents.length; i++) {
                RevenueEvent storage re = revenueEvents[i];
                earned[account] += re.revenue * _balances[account] / re.totalStaked;
            }

            lastFloor[account] = revenueEvents.length;
        }

        _;
    }

    /* ========== EVENTS ========== */

    event Staked(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RevenueClaimed(address indexed user, uint256 reward);
    event RevenueEventSaved(uint256 index, uint256 amount)
}


