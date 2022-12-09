// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.9;
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@uniswap/v3-periphery/contracts/libraries/TransferHelper.sol";

uint256 constant MAX_TOKENS = 2;

/**
    @title Reward Splitter
    @notice An abstract ERC20 token for splitting implementation-specific rewards
    @notice between its holders. Performs bookeeping math on transfers,
    @notice delegates rewards lookup and collecting to its children 
    @author Gene A. Tsvigun
    @author Vic G. Larson
  */
abstract contract RewardSplitter is ERC20 {
    uint256 internal constant PRECISION_RATIO = 1e21;

    // number of reward tokens managed by RS (instantiated RewardSplitter child)
    uint256 internal immutable _length;

    // addresses of reward tokens managed by RS 
    address[MAX_TOKENS] internal _rewardsTokens;
    // sum of total amounts of rewards accumulated per token, 
    // both claimed - transferred from reward source to RS balance, including amounts distributed to RS holders
    // and unclaimed - rewards due to RS that are yet to be transferred/minted  
    uint256[MAX_TOKENS] internal _lifetimeRewards;
    // total amounts claimed by RS per token, updated in `_claimRewardsFromUnderlying`
    uint256[MAX_TOKENS] internal _lifetimeRewardsClaimed;
    // sum of reward increments per single RS token
    // r(t1) / s(t1) + ... + r(tn) / s(tn)
    // where 
    // t0, t1 .. tn represent moments when any particular balance changes, including
    // * mints and burns, when `totalSupply` changes, as well as 
    // * mere transfers between holders, when `totalSupply` stays unchanged
    // s(t) is `totalSupply` right before the moment t
    // * t0 is the moment of the first mint 
    // * s(t0) = 0, r(t0) = 0
    // r(t+1) is how lifetime reward amount changed since t till (t+1)  
    uint256[MAX_TOKENS] internal _accRewardsPerToken;
    // rewards due to each RS holder per reward token
    // updated on holder balance change, starting at t1, and on reward claims by holders
    mapping(address => mapping(address => uint256)) internal _unclaimedRewards;
    // snapshots of `_accRewardsPerToken` per holder per reward token
    // these snapshots represent fractions of RS lifetime rewards taken into account so far
    // and added to `_unclaimedRewards` for each particular user
    // updated on holder balance change
    mapping(address => mapping(address => uint256)) internal _userSnapshotRewardsPerToken;

    /**
        @notice Accept and store reward token addresses
        @param token0 The address of token0
        @param token1 The address of token1. Can be zero for rewards in one currency.
     */
    constructor(address token0, address token1) {
        _rewardsTokens[0] = token0;
        uint256 length = 1;
        if (token1 != address(0)) {
            _rewardsTokens[1] = token1;
            length = 2;
        }
        _length = length;
    }

    /**
        @notice Claim rewards due to `msg.sender` and send them to the recipient
        @notice In case RS contract's balance is not enough for a payout, 
        @notice claims rewards from the source before the payout to RS holder
        @param recipient The recipient of rewards due to `msg.sender`
        @return tokens addresses of tokens paid as rewards
        @return amounts amounts paid to recipient
     */
    function _claimRewardsShareTo(address recipient)
        internal
        returns (address[MAX_TOKENS] memory tokens, uint256[MAX_TOKENS] memory amounts)
    {
        _updateRewards();
        _updateUser(msg.sender);
        for (uint256 i; i < _length; i++) {
            address token = _rewardsTokens[i];
            uint256 amountDue = _unclaimedRewards[token][msg.sender];
            // make sure there's enough balance to pay the amount due to `msg.sender`
            if (amountDue > IERC20(token).balanceOf(address(this))) 
                _claimRewardsFromUnderlying();
            TransferHelper.safeTransfer(token, recipient, amountDue);
            amounts[i] = amountDue;
            _unclaimedRewards[token][msg.sender] = 0;
        }
        return (_rewardsTokens, amounts);
    }

    /**
        @notice Updates rewards for both sender and receiver of each transfer
        @param from The address of the sender of tokens
        @param to The address of the receiver of tokens
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
        @notice Update the user's snapshot of rewards per token
        @param user The user to update
     */
    function _updateUserSnapshotRewardsPerToken(address user) internal {
        for (uint256 i; i < _length; i++) {
            _userSnapshotRewardsPerToken[_rewardsTokens[i]][user] = _accRewardsPerToken[i];
        }
    }

    /**
        @notice Update users' accumulated rewards data
        @notice taking into account non-claimed rewards that are still to be transferred to this contract's balance
        @notice This function should be called before any transfer of RS tokens
     */
    function _updateRewards() internal {
        uint256 supply = totalSupply();
        if (supply == 0) 
            return;
        
        // check rewards due to RS contract
        uint256[MAX_TOKENS] memory freshRewards = _freshRewards();

        for (uint256 i; i < _length; i++) {
            // calculate lifetime rewards at this moment
            uint256 lifetimeRewards = _lifetimeRewardsClaimed[i] + freshRewards[i];
            // subtract the value stored from last update 
            uint256 rewardsAccrued = lifetimeRewards - _lifetimeRewards[i];
            _accRewardsPerToken[i] += (rewardsAccrued * PRECISION_RATIO) / supply;
            _lifetimeRewards[i] = lifetimeRewards;
        }
    }

    /**
        @notice Updates rewards for a single user
        @notice This function should be called before any transfer of wrapper tokens
        @param user The address of the sender or receiver of wrapper tokens
     */
    function _updateUser(address user) internal {
        uint256[MAX_TOKENS] memory pendingRewards = _getPendingRewards(user);
        for (uint256 i; i < _length; i++) {
            _unclaimedRewards[_rewardsTokens[i]][user] += pendingRewards[i];
        }
        _updateUserSnapshotRewardsPerToken(user);
    }

    /**
        @notice Claim pending rewards from the source - 
        @notice mint/transfer reward tokens to RS balance 
        @notice This function should be called before any transfer of wrapper tokens
     */
    function _claimRewardsFromUnderlying() internal {
        uint256[MAX_TOKENS] memory amounts = _collectRewards();
        for (uint256 i; i < _length; i++) {
            _lifetimeRewardsClaimed[i] += amounts[i];
        }
    }

    /**
        @notice Snapshot of summary of rewards per single RS token for a user
        @notice recorded on the user's latest balance change
        @param index reward token index
        @param user the user for which snapshot lookup is performed
     */
    function userSnapshotRewardsPerToken(uint256 index, address user)
        internal
        view
        returns (uint256)
    {
        address token = _rewardsTokens[index];
        return _userSnapshotRewardsPerToken[token][user];
    }

    /**
        @notice Compute pending rewards for a user.
        @param user The user to compute pending rewards for
        @return pendingRewards The amount of pending rewards for each token
     */
    function _getPendingRewards(address user)
        internal
        view
        returns (uint256[MAX_TOKENS] memory pendingRewards)
    {
        uint256 balance = balanceOf(user);
        for (uint256 i; i < _length; i++) {
            uint256 sinceSnapshot = _accRewardsPerToken[i] - userSnapshotRewardsPerToken(i, user);
            pendingRewards[i] =
                balance * sinceSnapshot / PRECISION_RATIO;
        }
    }


     /**
        @notice Perform operations specific to a particular reward source to
        @notice get reward amounts due to RS contract
        @notice This function should be implemented by RS children
        @return freshRewards claimable rewards yet unclaimed
     */   
    function _freshRewards()
        internal
        view
        virtual
        returns (uint256[MAX_TOKENS] memory freshRewards);

    /**
        @notice Collect rewards from the contract paying them, like a Uniswap V3 pair
        @notice perform source-specific operations for that
        @notice This function should be implemented by RS children
        @return amounts The amount of rewards collected for each token
     */
    function _collectRewards() internal virtual returns (uint256[MAX_TOKENS] memory amounts);
}
