// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity ^0.8.17;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../../../interfaces/IRewardable.sol";

/**
 * @title RewardableERC20
 * @notice An abstract class that can be extended to create rewardable wrapper
 * @dev To inherit:
 *   - override _claimAssetRewards()
 *   - call ERC20 constructor elsewhere during construction
 */
abstract contract RewardableERC20 is IRewardable, ERC20 {
    using SafeERC20 for IERC20;

    uint256 public immutable one; // {qShare/share}
    IERC20 public immutable rewardToken;

    uint256 public rewardsPerShare; // {qRewards/share}
    mapping(address => uint256) public lastRewardsPerShare; // {qRewards/share}
    mapping(address => uint256) public accumulatedRewards; // {qRewards}
    mapping(address => uint256) public claimedRewards; // {qRewards}

    /// @dev Extending class must ensure ERC20 constructor is called
    constructor(IERC20 _rewardToken, uint8 _decimals) {
        rewardToken = _rewardToken;
        one = 10**_decimals;
    }

    function claimRewards() external {
        _claimAndSyncRewards();
        _syncAccount(msg.sender);
        _claimAccountRewards(msg.sender);
    }

    function _syncAccount(address account) internal {
        if (account == address(0)) return;
        uint256 shares = balanceOf(account);
        uint256 accountRewardsPerShare = lastRewardsPerShare[account];
        if (rewardsPerShare == accountRewardsPerShare) return;
        uint256 delta = rewardsPerShare - accountRewardsPerShare;

        // {qRewards} = {qRewards/share} * {qShare} / {qShare/share}
        uint256 newRewards = (delta * shares) / one;
        lastRewardsPerShare[account] = rewardsPerShare;
        accumulatedRewards[account] += newRewards;
    }

    function _claimAndSyncRewards() internal {
        uint256 delta;
        uint256 _totalSupply = totalSupply();
        if (_totalSupply > 0) {
            uint256 initialBal = rewardToken.balanceOf(address(this));
            _claimAssetRewards();
            uint256 endingBal = rewardToken.balanceOf(address(this));
            delta = endingBal - initialBal;

            // {qRewards/share} += {qRewards} * {qShare/share} / {qShare}
            rewardsPerShare += ((delta) * one) / _totalSupply;
        }
    }

    function _claimAccountRewards(address account) internal {
        uint256 claimableRewards = accumulatedRewards[account] - claimedRewards[account];
        emit RewardsClaimed(IERC20(address(rewardToken)), claimableRewards);
        if (claimableRewards == 0) return;
        claimedRewards[account] = accumulatedRewards[account];
        rewardToken.safeTransfer(account, claimableRewards);
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
