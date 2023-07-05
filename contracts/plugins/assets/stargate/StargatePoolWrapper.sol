// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../../../libraries/Fixed.sol";
import "./interfaces/IStargateLPStaking.sol";
import "./interfaces/IStargatePool.sol";
import "./interfaces/IStargatePoolWrapper.sol";

contract StargatePoolWrapper is IStargatePoolWrapper, ERC20 {
    using FixLib for uint192;

    IStargateLPStaking public immutable stakingContract;
    uint256 public immutable poolId;
    IStargatePool public immutable pool;
    uint8 public immutable poolDecimals;
    IERC20 public immutable stargate;
    uint256 public stgPerShare;

    mapping(address => uint256) public userCollected;
    mapping(address => uint256) public userOwed;

    constructor(
        string memory name,
        string memory symbol,
        IERC20 stargate_,
        IStargateLPStaking stakingContract_,
        IStargatePool pool_
    ) ERC20(name, symbol) {
        require(bytes(name).length != 0 && bytes(symbol).length != 0, "Invalid name or symbol");
        require(
            address(stargate_) != address(0) &&
                address(stakingContract_) != address(0) &&
                address(pool_) != address(0),
            "Invalid address"
        );

        uint256 poolLength = stakingContract_.poolLength();
        uint256 pid = type(uint256).max;
        for (uint256 i = 0; i < poolLength; ++i) {
            if (address(stakingContract_.poolInfo(i).lpToken) == address(pool_)) {
                pid = i;
                break;
            }
        }

        require(pid != type(uint256).max, "Invalid pool");

        pool_.approve(address(stakingContract_), type(uint256).max);

        pool = pool_;
        poolId = pid;
        poolDecimals = pool_.decimals();
        stakingContract = stakingContract_;
        stargate = stargate_;
    }

    function decimals() public view override(ERC20, IERC20Metadata) returns (uint8) {
        return poolDecimals;
    }

    function deposit(uint256 amount) external {
        require(amount != 0, "Invalid amount");

        _deposit(_msgSender(), amount);
    }

    function withdraw(uint256 amount) external {
        require(amount != 0, "Invalid amount");

        _withdraw(_msgSender(), amount);
    }

    function _deposit(address from, uint256 amount) internal {
        pool.transferFrom(from, address(this), amount);

        uint256 initialBalance = stargate.balanceOf(address(this));
        stakingContract.deposit(poolId, amount);
        uint256 userBalance = __userUpdateLogic(initialBalance, from);

        _mint(from, amount);
        userCollected[from] = ((userBalance + amount) * stgPerShare) / 1e12;
    }

    function _withdraw(address to, uint256 amount) internal {
        uint256 initialBalance = stargate.balanceOf(address(this));
        stakingContract.withdraw(poolId, amount);
        uint256 userBalance = __userUpdateLogic(initialBalance, to);

        _burn(to, amount);
        userCollected[to] = ((userBalance - amount) * stgPerShare) / 1e12;

        pool.transfer(to, amount);
    }

    function __userUpdateLogic(uint256 initialBalance, address user)
        internal
        returns (uint256 userBalance)
    {
        uint256 totalSupply_ = totalSupply();
        if (totalSupply_ != 0) {
            stgPerShare +=
                ((stargate.balanceOf(address(this)) - initialBalance) * 1e12) /
                totalSupply_;
        }
        userBalance = balanceOf(user);

        if (userBalance > 0) {
            uint256 pendingRewards = (userBalance * stgPerShare) /
                1e12 -
                userCollected[user] +
                userOwed[user];

            userOwed[user] = 0;
            stargate.transfer(user, pendingRewards);
        }
    }

    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal override {
        stakingContract.updatePool(poolId);
        uint256 expectedReward = stakingContract.pendingStargate(poolId, address(this));
        uint256 totalSupply_ = totalSupply();
        if (totalSupply_ != 0) {
            uint256 stgPerShare_ = (expectedReward * 1e12) / totalSupply_;
            userOwed[from] += (stgPerShare_ * amount) / 1e12;
            userCollected[to] += (stgPerShare_ * amount) / 1e12;
        }
    }

    function claimRewards() external {
        uint256 initialBalance = stargate.balanceOf(address(this));
        _deposit(_msgSender(), 0);
        uint256 finalBalance = stargate.balanceOf(address(this));

        emit RewardsClaimed(stargate, finalBalance - initialBalance);
    }

    function totalLiquidity() external view virtual returns (uint256) {
        return pool.totalLiquidity();
    }
}
