// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.9;
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@uniswap/v3-periphery/contracts/libraries/TransferHelper.sol";

uint256 constant MAX_TOKENS = 2;

/**
    @title Uniswap V3 Wrapper
    @notice ERC20 Wrapper token for Uniswap V3 positions
    @author Gene A. Tsvigun
    @author Vic G. Larson
  */
abstract contract RewardSplitter is ERC20 {
    uint256 internal constant PRECISION_RATIO = 1e21;

    uint256 internal immutable _length;

    address[MAX_TOKENS] internal _rewardsTokens;
    uint256[MAX_TOKENS] internal _lifetimeRewards;
    uint256[MAX_TOKENS] internal _lifetimeRewardsClaimed;
    uint256[MAX_TOKENS] internal _accRewardsPerToken;
    mapping(address => mapping(address => uint256)) internal _unclaimedRewards;
    mapping(address => mapping(address => uint256)) internal _userSnapshotRewardsPerToken;

    constructor(address[] memory tokens) {
        _length = tokens.length;
        for (uint256 i; i < _length; i++) {
            _rewardsTokens[i] = tokens[i];
        }
    }

    function _claimRewardsShareTo(address recipient)
        internal
        returns (address[MAX_TOKENS] memory tokens, uint256[MAX_TOKENS] memory amounts)
    {
        _updateRewards();
        _updateUser(msg.sender);
        for (uint256 i; i < _length; i++) {
            if (_unclaimedRewards[_rewardsTokens[i]][msg.sender] > IERC20(_rewardsTokens[i]).balanceOf(address(this))) {
                _claimRewardsFromUnderlying();
                break;
            }
        }
        for (uint256 i; i < _length; i++) {
            TransferHelper.safeTransfer(_rewardsTokens[i], recipient, _unclaimedRewards[_rewardsTokens[i]][msg.sender]);
            _unclaimedRewards[_rewardsTokens[i]][msg.sender] = 0;
        }
        //rearrange _unclaimedRewards
        for (uint256 i; i < _length; i++) {
            amounts[i] = _unclaimedRewards[_rewardsTokens[i]][msg.sender];
        }
        return (_rewardsTokens, amounts);
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
        for (uint256 i; i < _length; i++) {
            _userSnapshotRewardsPerToken[_rewardsTokens[i]][user] = _accRewardsPerToken[i];
        }
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
        uint256[MAX_TOKENS] memory freshRewards = _freshRewards();

        for (uint256 i; i < _length; i++) {
            uint256 lifetimeRewards = _lifetimeRewardsClaimed[i] + freshRewards[i];
            uint256 rewardsAccrued = lifetimeRewards - _lifetimeRewards[i];
            _accRewardsPerToken[i] += (rewardsAccrued * PRECISION_RATIO) / supply;
            _lifetimeRewards[i] = lifetimeRewards;
        }
    }

    /**
     * @notice Updates rewards for a single user
     * @notice This function should be called before any transfer of wrapper tokens
     * @param user The address of the sender or receiver of wrapper tokens
     */
    function _updateUser(address user) internal {
        uint256 balance = balanceOf(user);
        uint256[MAX_TOKENS] memory pendingRewards = _getPendingRewards(user, balance);
        for (uint256 i; i < _length; i++) {
            _unclaimedRewards[_rewardsTokens[i]][user] += pendingRewards[i];
        }
        _updateUserSnapshotRewardsPerToken(user);
    }

    function _claimRewardsFromUnderlying() internal {
        uint256[MAX_TOKENS] memory amounts = _collectRewards();
        for (uint256 i; i < _length; i++) {
            _lifetimeRewardsClaimed[i] += amounts[i];
        }
    }

    function userSnapshotRewardsPerToken(uint256 index, address user) internal view returns (uint256) {
        address token = _rewardsTokens[index];
        return _userSnapshotRewardsPerToken[token][user];
    }

    /**
     * @notice Compute pending rewards for a user.
     * @param user The user to compute pending rewards for
     * @param balance The balance of the user
     * @return pendingRewards The amount of pending rewards for each token
     */
    function _getPendingRewards(address user, uint256 balance)
        internal
        view
        returns (uint256[MAX_TOKENS] memory pendingRewards)
    {
        for (uint256 i; i < _length; i++) {
            pendingRewards[i] =
                (balance * (_accRewardsPerToken[i] - userSnapshotRewardsPerToken(i, user))) /
                PRECISION_RATIO;
        }
    }

    function _freshRewards() internal view virtual returns (uint256[MAX_TOKENS] memory freshRewards);

    /**
     * @notice Collect rewards from the contract paying them, like a Uniswap V3 position
     * @return amounts The amount of rewards collected for each token
     */
    function _collectRewards() internal virtual returns (uint256[MAX_TOKENS] memory amounts); //TODO make it usable for any number of tokens
}
