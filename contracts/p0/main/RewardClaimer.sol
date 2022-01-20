// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "contracts/p0/libraries/Rewards.sol";
import "contracts/p0/main/SettingsHandler.sol";
import "contracts/p0/main/Mixin.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/Pausable.sol";
import "./Auctioneer.sol";
import "./SettingsHandler.sol";

/**
 * @title RewardClaimer
 * @notice Claims rewards and leaves them in Main for Auctioneer to handle.
 */
contract RewardClaimerP0 is Pausable, Mixin, SettingsHandlerP0, AuctioneerP0, IRewardClaimer {
    using BasketLib for Basket;
    using SafeERC20 for IERC20Metadata;
    using FixLib for Fix;

    uint256 private _rewardsLastClaimed;

    function init(ConstructorArgs calldata args)
        public
        virtual
        override(Mixin, SettingsHandlerP0, AuctioneerP0)
    {
        super.init(args);
    }

    /// Collect COMP/AAVE rewards and take collateral profits based on appreciation
    function poke() public virtual override(Mixin, AuctioneerP0) notPaused {
        super.poke();
        uint256 compBalStart = compAsset().erc20().balanceOf(address(this));
        uint256 aaveBalStart = aaveAsset().erc20().balanceOf(address(this));
        (uint256 prevRewards, ) = _whenRewards(block.timestamp);
        if (prevRewards > _rewardsLastClaimed) {
            _rewardsLastClaimed = prevRewards;

            // Claim + Sweep COMP/AAVE from self + traders
            rsrTrader.claimAndSweepRewards();
            rTokenTrader.claimAndSweepRewards();
            RewardsLib.claimAndSweepRewards(address(this));
            uint256 compDelta = compAsset().erc20().balanceOf(address(this)) - compBalStart;
            uint256 aaveDelta = aaveAsset().erc20().balanceOf(address(this)) - aaveBalStart;
            emit RewardsClaimed(compDelta, aaveDelta);
        }
    }

    /// @return The timestamp of the next rewards event
    function nextRewards() public view override returns (uint256) {
        (, uint256 next) = _whenRewards(block.timestamp);
        return next;
    }

    // ==== Private ====

    // Return the reward boundaries on either side of *time* as timestamps.
    function _whenRewards(uint256 time) private view returns (uint256 left, uint256 right) {
        int256 reps = (int256(time) - int256(rewardStart())) / int256(rewardPeriod());
        left = uint256(reps * int256(rewardPeriod()) + int256(rewardStart()));
        right = left + rewardPeriod();
    }
}
