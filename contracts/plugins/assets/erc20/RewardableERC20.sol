// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity ^0.8.19;

import { ReentrancyGuard } from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../../../interfaces/IRewardable.sol";

/**
 * @title RewardableERC20
 * @notice An abstract class that can be extended to create rewardable wrapper.
 * @notice `_claimAssetRewards` keeps tracks of rewards by snapshotting the balance
 * and calculating the difference between the current balance and the previous balance.
 * @dev To inherit:
 *   - override _claimAssetRewards()
 *   - call ERC20 constructor elsewhere during construction
 */
abstract contract RewardableERC20 is IRewardable, ERC20, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public immutable one; // {qShare/share}
    IERC20 public immutable rewardToken;

    uint256 public rewardsPerShare; // {qRewards/share}
    mapping(address => uint256) public lastRewardsPerShare; // {qRewards/share}
    mapping(address => uint256) public accumulatedRewards; // {qRewards}
    mapping(address => uint256) public claimedRewards; // {qRewards}

    // Used to keep track of how many reward the Vault has accumulated
    // Whenever _claimAndSyncRewards() is called we will calculate the difference
    // between the current balance and `lastRewardBalance` to figure out how much to distribute
    uint256 internal lastRewardBalance = 0;

    /// @dev Extending class must ensure ERC20 constructor is called
    constructor(IERC20 _rewardToken, uint8 _decimals) {
        rewardToken = _rewardToken;
        one = 10**_decimals; // set via pass-in to prevent inheritance issues
    }

    function claimRewards() external nonReentrant {
        _claimAndSyncRewards();
        _syncAccount(msg.sender);
        _claimAccountRewards(msg.sender);
    }

    function _syncAccount(address account) internal {
        if (account == address(0)) return;

        // {qRewards/share}
        uint256 accountRewardsPerShare = lastRewardsPerShare[account];

        // {qShare}
        uint256 shares = balanceOf(account);

        // {qRewards}
        uint256 _accumulatedRewards = accumulatedRewards[account];

        // {qRewards/share}
        uint256 _rewardsPerShare = rewardsPerShare;
        if (accountRewardsPerShare < _rewardsPerShare) {
            // {qRewards/share}
            uint256 delta = _rewardsPerShare - accountRewardsPerShare;

            // {qRewards} = {qRewards/share} * {qShare}
            _accumulatedRewards += (delta * shares) / one;
        }
        lastRewardsPerShare[account] = _rewardsPerShare;
        accumulatedRewards[account] = _accumulatedRewards;
    }

    function _claimAndSyncRewards() internal virtual {
        uint256 _totalSupply = totalSupply();
        if (_totalSupply == 0) {
            return;
        }
        _claimAssetRewards();
        uint256 balanceAfterClaimingRewards = rewardToken.balanceOf(address(this));

        uint256 _rewardsPerShare = rewardsPerShare;
        uint256 _previousBalance = lastRewardBalance;

        if (balanceAfterClaimingRewards > _previousBalance) {
            uint256 delta = balanceAfterClaimingRewards - _previousBalance;
            uint256 deltaPerShare = (delta * one) / _totalSupply;

            balanceAfterClaimingRewards = _previousBalance + (deltaPerShare * _totalSupply) / one;

            // {qRewards/share} += {qRewards} * {qShare/share} / {qShare}
            _rewardsPerShare += deltaPerShare;
        }

        lastRewardBalance = balanceAfterClaimingRewards;
        rewardsPerShare = _rewardsPerShare;
    }

    function _claimAccountRewards(address account) internal {
        uint256 claimableRewards = accumulatedRewards[account] - claimedRewards[account];

        emit RewardsClaimed(IERC20(address(rewardToken)), claimableRewards);

        if (claimableRewards == 0) {
            return;
        }

        claimedRewards[account] = accumulatedRewards[account];

        uint256 currentRewardTokenBalance = rewardToken.balanceOf(address(this));

        // This is just to handle the edge case where totalSupply() == 0 and there
        // are still reward tokens in the contract.
        uint256 nonDistributed = currentRewardTokenBalance > lastRewardBalance
            ? currentRewardTokenBalance - lastRewardBalance
            : 0;

        rewardToken.safeTransfer(account, claimableRewards);

        currentRewardTokenBalance = rewardToken.balanceOf(address(this));
        lastRewardBalance = currentRewardTokenBalance > nonDistributed
            ? currentRewardTokenBalance - nonDistributed
            : 0;
    }

    function _beforeTokenTransfer(
        address from,
        address to,
        uint256
    ) internal virtual override {
        _claimAndSyncRewards();
        _syncAccount(from);
        _syncAccount(to);
    }

    /// === Must override ===

    function _claimAssetRewards() internal virtual;
}
