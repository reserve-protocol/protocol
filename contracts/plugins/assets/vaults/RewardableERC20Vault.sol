// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity ^0.8.17;

import "../../../interfaces/IRewardable.sol";
import "../../../vendor/solmate/ERC4626Rewardable.sol";
import "../../../vendor/solmate/ERC20Solmate.sol";
import "../../../vendor/solmate/SafeTransferLib.sol";

abstract contract RewardableERC20Vault is IRewardable, ERC4626Rewardable {
    using SafeTransferLib for ERC20Solmate;

    uint256 public immutable one;
    ERC20Solmate public immutable rewardToken;

    uint256 public rewardsPerShare;
    mapping(address => uint256) public lastRewardsPerShare;
    mapping(address => uint256) public accumulatedRewards;
    mapping(address => uint256) public claimedRewards;

    constructor(
        ERC20Solmate _asset,
        string memory _name,
        string memory _symbol,
        ERC20Solmate _rewardToken
    ) ERC4626Rewardable(_asset, _name, _symbol) {
        rewardToken = _rewardToken;
        one = 10**_asset.decimals();
    }

    function claimRewards() external {
        _claimAndSyncRewards();
        _syncAccount(msg.sender, balanceOf[msg.sender]);
        _claimAccountRewards(msg.sender);
    }

    function _syncAccount(address account, uint256 shares) internal {
        uint256 accountRewardsPershare = lastRewardsPerShare[account];
        if (rewardsPerShare == accountRewardsPershare) return;
        uint256 delta = rewardsPerShare - accountRewardsPershare;
        uint256 newRewards = (delta * shares) / one;
        lastRewardsPerShare[account] = rewardsPerShare;
        accumulatedRewards[account] += newRewards;
    }

    function _claimAndSyncRewards() internal {
        uint256 delta;
        if (totalSupply > 0) {
            uint256 initialBal = rewardToken.balanceOf(address(this));
            _claimAssetRewards();
            uint256 endingBal = rewardToken.balanceOf(address(this));
            delta = endingBal - initialBal;
            rewardsPerShare += ((delta) * one) / totalSupply;
        }
        emit RewardsClaimed(IERC20(address(rewardToken)), delta);
    }

    function _claimAssetRewards() internal virtual;

    function _claimAccountRewards(address account) internal {
        uint256 claimableRewards = accumulatedRewards[account] - claimedRewards[account];
        if (claimableRewards == 0) return;
        claimedRewards[account] = accumulatedRewards[account];
        rewardToken.safeTransfer(account, claimableRewards);
    }

    function totalAssets() public view virtual override returns (uint256) {
        return totalSupply;
    }

    function beforeWithdraw(
        uint256,
        uint256,
        address owner
    ) internal virtual override {
        _claimAndSyncRewards();
        _syncAccount(owner, balanceOf[owner]);
    }

    function beforeDeposit(
        uint256,
        uint256,
        address receiver
    ) internal virtual override {
        _claimAndSyncRewards();
        _syncAccount(receiver, balanceOf[receiver]);
    }
}
