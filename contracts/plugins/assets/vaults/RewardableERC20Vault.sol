// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity ^0.8.17;

import "../../../interfaces/IRewardable.sol";
import "../../../vendor/oz/ERC4626.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

abstract contract RewardableERC20Vault is IRewardable, ERC4626 {
    using SafeERC20 for ERC20;

    uint256 public immutable one;
    ERC20 public immutable rewardToken;

    uint256 public rewardsPerShare;
    mapping(address => uint256) public lastRewardsPerShare;
    mapping(address => uint256) public accumulatedRewards;
    mapping(address => uint256) public claimedRewards;

    constructor(
        ERC20 _asset,
        string memory _name,
        string memory _symbol,
        ERC20 _rewardToken
    ) ERC4626(_asset, _name, _symbol) {
        rewardToken = _rewardToken;
        one = 10**decimals();
    }

    function claimRewards() external {
        _claimAndSyncRewards();
        _syncAccount(msg.sender);
        _claimAccountRewards(msg.sender);
    }

    function _syncAccount(address account) internal {
        if (account == address(0)) return;
        uint256 shares = balanceOf(account);
        uint256 accountRewardsPershare = lastRewardsPerShare[account];
        if (rewardsPerShare == accountRewardsPershare) return;
        uint256 delta = rewardsPerShare - accountRewardsPershare;
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
            rewardsPerShare += ((delta) * one) / _totalSupply;
        }
    }

    function _claimAssetRewards() internal virtual;

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
        uint256 amount
    ) internal virtual override {
        _claimAndSyncRewards();
        _syncAccount(from);
        _syncAccount(to);
    }
}
