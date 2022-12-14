// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/plugins/goldfinch/IGoldfinch.sol";

/**
 * @title GoldfinchStakingWrapper
 * @notice FIDU only earns GFI rewards when staked in a Synthetix-style staking contract.
 * These positions are not inherently transferable, so this contract facilitates wrapping staked
 * positions into an `erc20` token for use in a collateral adapter
 **/
contract GoldfinchStakingWrapper is ERC20, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // GFI reward token address
    // solhint-disable-next-line var-name-mixedcase
    IERC20 public REWARD_TOKEN = IERC20(0xdab396cCF3d84Cf2D07C4454e10C8A6F5b008D2b);
    IERC20 public fidu;
    IGoldfinchStaking public goldfinchStaking;
    uint256 public tokenId;

    uint256 internal _accRewardsPerToken;
    uint256 internal _lifetimeRewardsClaimed;
    uint256 internal _lifetimeRewards;
    uint256 internal _lastRewardBlock;

    // user => unclaimedRewards
    mapping(address => uint256) public _unclaimedRewards;
    // user => _accRewardsPerToken at last interaction
    mapping(address => uint256) private _userSnapshotRewardsPerToken;

    constructor(
        string memory name_,
        string memory symbol_,
        address goldfinchStaking_,
        address fidu_
    ) ERC20(name_, symbol_) {
        goldfinchStaking = IGoldfinchStaking(goldfinchStaking_);
        fidu = IERC20(fidu_);
    }

    function decimals() public pure override returns (uint8) {
        return 18;
    }

    /**
     * @notice Deposits FIDU in the staking contract and mints wFIDU to msg.sender
     * @param _to The address that will receive the wFIDU
     * @param _amount The amount of FIDU to deposit (== amount minted)
     **/
    function deposit(address _to, uint256 _amount) external nonReentrant {
        _deposit(msg.sender, _to, _amount);
    }

    /**
     * @notice Burns `amount` of wFIDU, with sender receiving the corresponding amount of FIDU
     * @param _amount The amount to withdraw
     **/
    function withdraw(uint256 _amount) external nonReentrant {
        _withdraw(msg.sender, _amount);
    }

    /**
     * @notice Claims rewards from goldfinchStaking and updates internal accounting of rewards.
     */
    function collectAndUpdateRewards() external nonReentrant {
        _collectAndUpdateRewards();
    }

    /**
     * @notice Get the total claimable rewards of the contract.
     * @return The current balance + pending rewards from goldfinchStaking
     */
    function getTotalClaimableRewards() external view returns (uint256) {
        if (tokenId == 0) return 0;

        uint256 freshRewards = goldfinchStaking.earnedSinceLastCheckpoint(tokenId);
        return REWARD_TOKEN.balanceOf(address(this)) + freshRewards;
    }

    /**
     * @notice Get the total claimable rewards for a user
     * @param user The address of the user
     * @return The claimable amount of rewards
     */
    function getClaimableRewards(address user) external view returns (uint256) {
        return _getClaimableRewards(user, balanceOf(user), true);
    }

    function getAccRewardsPerToken() external view returns (uint256) {
        return _accRewardsPerToken;
    }

    function getLifetimeRewardsClaimed() external view returns (uint256) {
        return _lifetimeRewardsClaimed;
    }

    function getLifetimeRewards() external view returns (uint256) {
        return _lifetimeRewards;
    }

    function getLastRewardBlock() external view returns (uint256) {
        return _lastRewardBlock;
    }

    function claimRewards(bool forceUpdate, address recipient) external nonReentrant {
        if (tokenId == 0) return;
        _claimRewards(msg.sender, recipient, forceUpdate);
    }

    function _deposit(
        address _from,
        address _to,
        uint256 _amount
    ) internal {
        require(_amount > 0, "GoldfinchStakingWrapper: deposit == 0");
        _updateRewards();

        fidu.safeTransferFrom(_from, address(this), _amount);
        fidu.safeApprove(address(goldfinchStaking), 0);
        fidu.safeApprove(address(goldfinchStaking), _amount);

        if (tokenId == 0) {
            tokenId = goldfinchStaking.stake(_amount, StakedPositionType.Fidu);
        } else {
            goldfinchStaking.addToStake(tokenId, _amount);
        }
        _mint(_to, _amount);
    }

    function _withdraw(address _user, uint256 _amount) internal {
        require(_amount > 0, "GoldfinchStakingWrapper: withdraw == 0");
        require(balanceOf(_user) >= _amount, "GoldfinchStakingWrapper: insufficient user balance");
        require(
            goldfinchStaking.stakedBalanceOf(tokenId) >= _amount,
            "GoldfinchStakingWrapper: insufficient staked balance"
        );
        _updateRewards();

        goldfinchStaking.unstake(tokenId, _amount);
        fidu.safeTransfer(_user, _amount);
        _burn(_user, _amount);
    }

    function _claimRewards(
        address user,
        address recipient,
        bool forceUpdate
    ) internal {
        if (forceUpdate) _collectAndUpdateRewards();

        uint256 balance = balanceOf(user);
        uint256 reward = _getClaimableRewards(recipient, balance, false);

        // Permit small rounding errors
        uint256 totBal = REWARD_TOKEN.balanceOf(address(this));
        if (reward > totBal) {
            reward = totBal;
        }

        _unclaimedRewards[user] = 0;
        _updateUserSnapshotRewardsPerToken(user);
        REWARD_TOKEN.safeTransfer(recipient, reward);
    }

    /**
     * @notice Updates rewards for senders and receiver in a transfer
     * (not updating rewards for address(0))
     * @param from The address of the sender of tokens
     * @param to The address of the receiver of tokens
     */
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256
    ) internal override {
        if (tokenId == 0) return;
        if (from != address(0)) _updateUser(from);
        if (to != address(0)) _updateUser(to);
    }

    /**
     * @notice Adding the pending rewards to the unclaimed for specific user and updating user index
     * @param user The address of the user to update
     */
    function _updateUser(address user) internal {
        uint256 balance = balanceOf(user);
        if (balance > 0) {
            uint256 pending = _getPendingRewards(user, balance, false);
            _unclaimedRewards[user] = _unclaimedRewards[user] + pending;
        }
        _updateUserSnapshotRewardsPerToken(user);
    }

    /**
     * @notice Updates virtual internal accounting of rewards.
     */
    function _updateRewards() internal {
        if (tokenId == 0) return;

        if (block.number > _lastRewardBlock) {
            _lastRewardBlock = block.number;
            uint256 supply = totalSupply();
            // No rewards can have accrued since last because there were no funds.
            if (supply == 0) return;

            (uint256 accRewardsPerToken, uint256 lifetimeRewards) = _getUpdatedAccRewardsPerToken();

            _accRewardsPerToken = accRewardsPerToken;
            _lifetimeRewards = lifetimeRewards;
        }
    }

    function _collectAndUpdateRewards() internal {
        if (tokenId == 0) return;

        _lastRewardBlock = block.number;
        uint256 supply = totalSupply();

        uint256 oldBal = REWARD_TOKEN.balanceOf(address(this));
        goldfinchStaking.getReward(tokenId);
        uint256 freshlyClaimed = REWARD_TOKEN.balanceOf(address(this)) - oldBal;
        uint256 lifetimeRewards = _lifetimeRewardsClaimed + freshlyClaimed;

        if (supply > 0 && freshlyClaimed > 0)
            _accRewardsPerToken = _accRewardsPerToken + ((freshlyClaimed * FIX_ONE) / supply);

        if (freshlyClaimed > 0) _lifetimeRewards = lifetimeRewards;

        _lifetimeRewardsClaimed = lifetimeRewards;
    }

    /**
     * @notice Compute the pending rewards.
     * @param user The user to compute for
     * @param balance The balance of the user
     * @param fresh Flag to account for rewards not claimed by contract yet
     * @return amount of pending rewards
     */
    function _getPendingRewards(
        address user,
        uint256 balance,
        bool fresh
    ) internal view returns (uint256) {
        if (tokenId == 0) return 0;

        if (balance == 0) return 0;

        uint256 supply = totalSupply();
        uint256 accRewardsPerToken = _accRewardsPerToken;

        if (supply != 0 && fresh) {
            (accRewardsPerToken, ) = _getUpdatedAccRewardsPerToken();
        }

        return ((balance * (accRewardsPerToken - _userSnapshotRewardsPerToken[user])) / FIX_ONE);
    }

    /**
     * @notice Compute the claimable rewards for a user
     * @param user The address of the user
     * @param balance The balance of the user
     * @param fresh Flag to account for rewards not claimed by contract yet
     * @return The total rewards that can be claimed by the user
     * (if `fresh` flag true, after updating rewards)
     */
    function _getClaimableRewards(
        address user,
        uint256 balance,
        bool fresh
    ) internal view returns (uint256) {
        uint256 pendingReward = _getPendingRewards(user, balance, fresh);
        uint256 reward = _unclaimedRewards[user] + pendingReward;
        return reward;
    }

    function _getUpdatedAccRewardsPerToken() internal view returns (uint256, uint256) {
        uint256 freshRewards = goldfinchStaking.earnedSinceLastCheckpoint(tokenId);
        uint256 lifetimeRewards = _lifetimeRewardsClaimed + freshRewards;
        return (_accRewardsPerToken + ((freshRewards * FIX_ONE) / totalSupply()), lifetimeRewards);
    }

    /**
     * @notice Update the rewardDebt for a user with balance as his balance
     * @param user The user to update
     */
    function _updateUserSnapshotRewardsPerToken(address user) internal {
        _userSnapshotRewardsPerToken[user] = _accRewardsPerToken;
    }
}
