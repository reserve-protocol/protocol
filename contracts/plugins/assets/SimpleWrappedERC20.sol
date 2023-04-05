// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "../../interfaces/IRewardableAsset.sol";
import "../../vendor/solmate/ERC4626Rewardable.sol";
import "../../vendor/solmate/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

abstract contract SimpleWrappedERC20 is IRewardableAsset, ERC4626Rewardable {
    using SafeERC20 for ERC20;

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
	}

    function _syncAccount(address account, uint256 shares) internal {
        uint256 accountRewardsPershare = lastRewardsPerShare[account];
        if (rewardsPerShare == accountRewardsPershare) return;
        uint256 delta = rewardsPerShare - accountRewardsPershare;
        uint256 newRewards = delta * shares / FIXED_SCALE;
        lastRewardsPerShare[account] = rewardsPerShare;
        accumulatedRewards[account] += newRewards;
    }

    function claimRewards() external {
        _claimWrappedRewards();
        _syncAccount(msg.sender, balanceOf[msg.sender]);
        _claimAccountRewards(msg.sender);
    }

    function _claimWrappedRewards() internal virtual {
        /*
            implement logic to claim rewards for wrapped token
            rewardsPerShare += (amountClaimed * FIXED_SCALE / totalSupply)
        */
    }

    function _claimAccountRewards(address account) internal {
        uint256 currentBal = rewardToken.balanceOf(address(this));
        rewardsPerShare += currentBal * FIXED_SCALE / totalSupply;

        uint256 claimableRewards = accumulatedRewards[account] - claimedRewards[account];
        if (claimableRewards == 0) return;
        claimedRewards[account] = accumulatedRewards[account];
        asset.safeTransfer(receiver, claimableRewards);
    }

    function totalAssets() public view virtual override returns (uint256) {
        return totalSupply;
    }

    function beforeWithdraw(uint256 assets, uint256 shares, address owner) internal virtual override {
        _syncAccount(owner, balanceOf[owner]);
    }

    function afterDeposit(uint256 assets, uint256 shares, address receiver) internal virtual override {
        _syncAccount(receiver, balanceOf[receiver] - shares);
    }
}