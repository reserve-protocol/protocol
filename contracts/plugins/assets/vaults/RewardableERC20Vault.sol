// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity ^0.8.19;

import "../../../interfaces/IRewardable.sol";
import "../../../vendor/oz/ERC4626.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title RewardableERC20Vault
 * @notice A transferrable vault token wrapping an inner ERC20 that earns rewards.
 *   Holding the vault token for a period of time earns the holder the right to
 *   their prorata share of the global rewards earned during that time.
 * @dev To inherit, override _claimAssetRewards()
 */
abstract contract RewardableERC20Vault is IRewardable, ERC4626 {
    using SafeERC20 for ERC20;

    uint256 public immutable one; // {qShare/share}
    ERC20 public immutable rewardToken;

    uint256 public rewardsPerShare; // {qRewards/share}
    mapping(address => uint256) public lastRewardsPerShare; // {qRewards/share}
    mapping(address => uint256) public accumulatedRewards; // {qRewards}
    mapping(address => uint256) public claimedRewards; // {qRewards}

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
        uint256
    ) internal virtual override {
        _claimAndSyncRewards();
        _syncAccount(from);
        _syncAccount(to);
    }

    function _decimalsOffset() internal view virtual override returns (uint8) {
        return 9;
    }
}
