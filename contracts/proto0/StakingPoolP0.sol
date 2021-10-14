// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "./interfaces/IStakingPool.sol";

interface IRToken is IERC20 {}

/*
 * @title StakingPool
 * @dev The StakingPool is where people can stake their RSR in order to provide insurance and
 * benefit from the supply expansion of an RToken. System-0 version.
 */
contract StakingPoolP0 is IStakingPool, Ownable {
    using SafeERC20 for IERC20;
    using EnumerableSet for EnumerableSet.AddressSet;

    IRToken public rToken;
    IERC20 public rsr;

    // Amount of RSR staked per account
    mapping(address => uint256) internal _stakes;

    // List of accounts
    EnumerableSet.AddressSet internal _accounts;

    // Total staked
    uint256 internal _totalStaked;

    // Delayed Withdrawals
    struct Withdrawal {
        address account;
        uint256 amount;
        uint256 timestamp;
    }

    Withdrawal[] public withdrawals;
    uint256 public withdrawalIndex;

    // Configuration
    uint256 public stakingWithdrawalDelay;

    constructor(
        address rToken_,
        address rsr_,
        uint256 stakingWithdrawalDelay_
    ) {
        rToken = IRToken(rToken_);
        rsr = IERC20(rsr_);
        stakingWithdrawalDelay = stakingWithdrawalDelay_;
        rsr.safeApprove(rToken_, type(uint256).max);
    }

    // Stake RSR
    function stake(uint256 amount) external override {
        // Process pending withdrawals
        processWithdrawals();

        require(amount > 0, "Cannot stake zero");

        rsr.safeTransferFrom(_msgSender(), address(this), amount);
        _accounts.add(_msgSender());
        _stakes[_msgSender()] += amount;
        _totalStaked += amount;
    }

    function unstake(uint256 amount) external override {
        // Process pending withdrawals
        processWithdrawals();

        require(amount > 0, "Cannot withdraw zero");
        require(_stakes[_msgSender()] >= amount, "Not enough balance");

        // Submit delayed withdrawal
        withdrawals.push(Withdrawal(_msgSender(), amount, block.timestamp));
    }

    function balanceOf(address account) external view override returns (uint256) {
        // Option A - ignore funds sent directly to contract
        return _stakes[account];
        // Option B - Always consider current RSR balance - Should we also consider it at time of stake/unstake?
        //  if (_totalStaked == 0) {
        //      return 0;
        //  }
        //  return (rsr.balanceOf(address(this)) * _stakes[account]) / _totalStaked;
    }

    function totalStaked() external view returns (uint256) {
        return _totalStaked;
    }

    function processWithdrawals() public {
        // Process all pending withdrawals
        for (uint256 index = withdrawalIndex; index < withdrawals.length; index++) {
            if (block.timestamp > withdrawals[withdrawalIndex].timestamp + stakingWithdrawalDelay) {
                Withdrawal storage withdrawal = withdrawals[withdrawalIndex];
                uint256 amount = Math.min(_stakes[withdrawal.account], withdrawal.amount);

                if (amount > 0) {
                    _stakes[withdrawal.account] -= amount;
                    _totalStaked -= amount;
                    rsr.safeTransfer(withdrawal.account, amount);
                }

                delete withdrawals[withdrawalIndex];
                withdrawalIndex += 1;
            } else {
                break;
            }
        }
    }

    function addRSR(uint256 amount) external override {
        require(_msgSender() == address(rToken), "Caller is not RToken");
        require(amount > 0, "Amount cannot be zero");

        // Process pending withdrawals
        processWithdrawals();

        rsr.safeTransferFrom(address(rToken), address(this), amount);

        uint256 _snapshotTotalStaked = _totalStaked;
        _totalStaked += amount;

        // Redistribute RSR to stakers
        if (_snapshotTotalStaked > 0) {
            for (uint256 index = 0; index < _accounts.length(); index++) {
                uint256 amtToAdd = (amount * _stakes[_accounts.at(index)]) / _snapshotTotalStaked;
                _stakes[_accounts.at(index)] += amtToAdd;
            }
        }
    }

    function seizeRSR(uint256 amount) external override {
        require(_msgSender() == address(rToken), "Caller is not RToken");
        require(amount > 0, "Amount cannot be zero");

        // Process pending withdrawals
        processWithdrawals();

        uint256 _snapshotTotalStaked = _totalStaked;
        _totalStaked -= amount;

        // Remove RSR for stakers
        if (_snapshotTotalStaked > 0) {
            for (uint256 index = 0; index < _accounts.length(); index++) {
                uint256 amtToRemove = (amount * _stakes[_accounts.at(index)]) / _snapshotTotalStaked;
                _stakes[_accounts.at(index)] -= amtToRemove;
            }
        }
        // Transfer RSR to RToken
        rsr.safeTransfer(address(rToken), amount);
    }

    function setStakingWithdrawalDelay(uint256 stakingWithdrawalDelay_) external onlyOwner {
        stakingWithdrawalDelay = stakingWithdrawalDelay_;
    }
}
