// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/p0/libraries/Rewards.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/interfaces/IRewardClaimer.sol";
import "contracts/p0/Component.sol";

/**
 * @title RewardClaimer
 * @notice Claims rewards every reward cycle and leaves them in Main for Auctioneer to handle.
 */
contract RewardClaimerP0 is IRewardClaimer, Component {
    using EnumerableSet for EnumerableSet.AddressSet;
    using FixLib for Fix;
    using SafeERC20 for IERC20;

    uint256 private rewardsLastClaimed;

    EnumerableSet.AddressSet private _claimAdapters;

    function init(ConstructorArgs calldata args) internal override {
        for (uint256 i = 0; i < args.claimAdapters.length; i++) {
            _claimAdapters.add(address(args.claimAdapters[i]));
        }
    }

    /// Collect rewards and leave for Auctioneer
    function claimRewards() external override notPaused {
        // Check if its time to claim
        (uint256 prevRewards, ) = whenRewards(block.timestamp);
        if (prevRewards <= rewardsLastClaimed) return;

        rewardsLastClaimed = prevRewards;

        // Claim rewards
        (IERC20Metadata[] memory erc20s, uint256[] memory amts) = RewardsLib.claimRewards(
            IMain(address(this))
        );
        for (uint256 i = 0; i < erc20s.length; i++) {
            emit RewardsClaimed(erc20s[i], amts[i]);
        }
    }

    function addClaimAdapter(IClaimAdapter claimAdapter) external override onlyOwner {
        emit ClaimAdapterAdded(claimAdapter);
        _claimAdapters.add(address(claimAdapter));
    }

    function removeClaimAdapter(IClaimAdapter claimAdapter) external override onlyOwner {
        emit ClaimAdapterRemoved(claimAdapter);
        _claimAdapters.remove(address(claimAdapter));
    }

    function isTrustedClaimAdapter(IClaimAdapter claimAdapter) public view override returns (bool) {
        return _claimAdapters.contains(address(claimAdapter));
    }

    function claimAdapters() public view override returns (IClaimAdapter[] memory adapters) {
        adapters = new IClaimAdapter[](_claimAdapters.length());
        for (uint256 i = 0; i < _claimAdapters.length(); i++) {
            adapters[i] = IClaimAdapter(_claimAdapters.at(i));
        }
    }

    /// @return next The timestamp of the next rewards event
    function nextRewards() public view returns (uint256 next) {
        (, next) = whenRewards(block.timestamp);
    }

    // ==== Private ====

    // Return the reward boundaries on either side of `time` as timestamps.
    function whenRewards(uint256 time) private view returns (uint256 left, uint256 right) {
        int256 start = int256(main.settings().rewardStart());
        int256 period = int256(main.settings().rewardPeriod());
        int256 reps = (int256(time) - start) / period;
        left = uint256(reps * period + start);
        right = left + uint256(period);
    }
}
