// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.9;
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@uniswap/v3-periphery/contracts/libraries/TransferHelper.sol";

/**
    @title Uniswap V3 Wrapper
    @notice ERC20 Wrapper token for Uniswap V3 positions
    @author Gene A. Tsvigun
    @author Vic G. Larson
  */
abstract contract RewardSplitter is ERC20 {
    uint256 internal constant PRECISION_RATIO = 1e21;
    address[] internal _rewardsTokens;
    uint256[] internal _lifetimeRewards;
    uint256[] internal _lifetimeRewardsClaimed;
    uint256[] internal _accRewardsPerToken;
    mapping(address => mapping(address => uint256)) internal _unclaimedRewards;
    mapping(address => mapping(address => uint256)) internal _userSnapshotRewardsPerToken;

    constructor(address[] memory tokens) {
        _rewardsTokens = tokens;
        _lifetimeRewards = new uint256[](tokens.length);
        _lifetimeRewardsClaimed = new uint256[](tokens.length);
        _accRewardsPerToken = new uint256[](tokens.length);
    }

    function _claimRewardsShareTo(address recipient)
        internal
        returns (
            address token0,
            address token1,
            uint256 amount0,
            uint256 amount1
        )
    {
        _updateRewards();
        _updateUser(msg.sender);
        if (
            _unclaimedRewards[_rewardsTokens[0]][msg.sender] > IERC20(_rewardsTokens[0]).balanceOf(address(this)) ||
            _unclaimedRewards[_rewardsTokens[1]][msg.sender] > IERC20(_rewardsTokens[1]).balanceOf(address(this))
        ) {
            _claimRewardsFromUnderlying();
        }
        TransferHelper.safeTransfer(_rewardsTokens[0], recipient, _unclaimedRewards[_rewardsTokens[0]][msg.sender]);
        TransferHelper.safeTransfer(_rewardsTokens[1], recipient, _unclaimedRewards[_rewardsTokens[1]][msg.sender]);
        _unclaimedRewards[_rewardsTokens[0]][msg.sender] = 0;
        _unclaimedRewards[_rewardsTokens[1]][msg.sender] = 0;
        return (
            _rewardsTokens[0],
            _rewardsTokens[1],
            _unclaimedRewards[_rewardsTokens[0]][msg.sender],
            _unclaimedRewards[_rewardsTokens[1]][msg.sender]
        );
    }

    /**
     * @notice Updates rewards for both sender and receiver of each transfer
     * @param from The address of the sender of tokens
     * @param to The address of the receiver of tokens
     */
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256
    ) internal override {
        _updateRewards();
        if (from != address(0)) {
            _updateUser(from);
        }
        if (to != address(0)) {
            _updateUser(to);
        }
    }

    /**
     * @notice Update the user's snapshot of rewards per token
     * @param user The user to update
     */
    function _updateUserSnapshotRewardsPerToken(address user) internal {
        _userSnapshotRewardsPerToken[_rewardsTokens[0]][user] = _accRewardsPerToken[0];
        _userSnapshotRewardsPerToken[_rewardsTokens[1]][user] = _accRewardsPerToken[1];
    }

    /**
     * @notice Update users' accumulated rewards data
     * @notice taking into account non-claimed rewards that are still to be transferred to this contract's balance
     * @notice This function should be called before any transfer of wrapper tokens
     */
    function _updateRewards() internal {
        uint256 supply = totalSupply();
        if (supply == 0) {
            return;
        }
        (uint256 freshRewards0, uint256 freshRewards1) = _freshRewards();

        uint256 lifetimeRewards0 = _lifetimeRewardsClaimed[0] + freshRewards0;
        uint256 lifetimeRewards1 = _lifetimeRewardsClaimed[1] + freshRewards1;

        uint256 rewardsAccrued0 = lifetimeRewards0 - _lifetimeRewards[0];
        uint256 rewardsAccrued1 = lifetimeRewards1 - _lifetimeRewards[1];

        _accRewardsPerToken[0] += (rewardsAccrued0 * PRECISION_RATIO) / supply;
        _accRewardsPerToken[1] += (rewardsAccrued1 * PRECISION_RATIO) / supply;
        _lifetimeRewards[0] = lifetimeRewards0;
        _lifetimeRewards[1] = lifetimeRewards1;
    }

    /**
     * @notice Updates rewards for a single user
     * @notice This function should be called before any transfer of wrapper tokens
     * @param user The address of the sender or receiver of wrapper tokens
     */
    function _updateUser(address user) internal {
        uint256 balance = balanceOf(user);
        (uint256 pending0, uint256 pending1) = _getPendingRewards(user, balance);
        _unclaimedRewards[_rewardsTokens[0]][user] += pending0;
        _unclaimedRewards[_rewardsTokens[1]][user] += pending1;
        _updateUserSnapshotRewardsPerToken(user);
    }

    function _claimRewardsFromUnderlying() internal {
        (uint256 amount0, uint256 amount1) = _collectRewards();
        _lifetimeRewardsClaimed[0] += amount0;
        _lifetimeRewardsClaimed[1] += amount1;
    }

    function userSnapshotRewardsPerToken(uint256 index, address user) internal view returns (uint256) {
        address token = _rewardsTokens[index];
        return _userSnapshotRewardsPerToken[token][user];
    }

    /**
     * @notice Compute pending rewards for a user.
     * @param user The user to compute pending rewards for
     * @param balance The balance of the user
     * @return pending0 The amount of pending rewards for token0
     * @return pending1 The amount of pending rewards for token1
     */
    function _getPendingRewards(address user, uint256 balance)
        internal
        view
        returns (uint256 pending0, uint256 pending1)
    {
        pending0 = (balance * (_accRewardsPerToken[0] - userSnapshotRewardsPerToken(0, user))) / PRECISION_RATIO;
        pending1 = (balance * (_accRewardsPerToken[1] - userSnapshotRewardsPerToken(1, user))) / PRECISION_RATIO;
    }

    function _freshRewards() internal view virtual returns (uint256, uint256);

    /**
     * @notice Collect rewards from the contract paying them, like a Uniswap V3 position
     * @return amount0 The amount of rewards collected for token0
     * @return amount1 The amount of rewards collected for token1
     */
    function _collectRewards() internal virtual returns (uint256 amount0, uint256 amount1); //TODO make it usable for any number of tokens
}
