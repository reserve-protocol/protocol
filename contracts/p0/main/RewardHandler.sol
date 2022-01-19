// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "contracts/p0/assets/ATokenCollateral.sol";
import "contracts/p0/interfaces/IOracle.sol";
import "contracts/p0/libraries/Rewards.sol";
import "contracts/p0/main/RevenueDistributor.sol";
import "contracts/p0/main/SettingsHandler.sol";
import "contracts/p0/main/BasketHandler.sol";
import "contracts/p0/main/Mixin.sol";
import "contracts/p0/interfaces/IAsset.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/Pausable.sol";
import "./Auctioneer.sol";
import "./SettingsHandler.sol";
import "./BasketHandler.sol";

/**
 * @title RewardHandler
 * Brings revenue into the system, including asset growth and rewards from other protocols.
 */
contract RewardHandlerP0 is
    Pausable,
    Mixin,
    SettingsHandlerP0,
    RevenueDistributorP0,
    BasketHandlerP0,
    AuctioneerP0,
    IRewardHandler
{
    using BasketLib for Basket;
    using SafeERC20 for IERC20Metadata;
    using FixLib for Fix;

    uint256 private _rewardsLastClaimed;

    function init(ConstructorArgs calldata args)
        public
        virtual
        override(Mixin, SettingsHandlerP0, RevenueDistributorP0, BasketHandlerP0, AuctioneerP0)
    {
        super.init(args);
    }

    /// Collect COMP/AAVE rewards and take collateral profits based on appreciation
    function poke() public virtual override(Mixin, BasketHandlerP0, AuctioneerP0) notPaused {
        super.poke();
        uint256 compBalStart = compAsset().erc20().balanceOf(address(this));
        uint256 aaveBalStart = aaveAsset().erc20().balanceOf(address(this));
        (uint256 prevRewards, ) = _whenRewards(block.timestamp);
        if (prevRewards > _rewardsLastClaimed && fullyCapitalized()) {
            _takeProfits();

            // Claim + Sweep COMP/AAVE from self + traders
            backingTrader.claimAndSweepRewards();
            rsrTrader.claimAndSweepRewards();
            rTokenTrader.claimAndSweepRewards();
            RewardsLib.claimAndSweepRewards(address(this));
            _rewardsLastClaimed = prevRewards;
        }
        uint256 compDelta = compAsset().erc20().balanceOf(address(this)) - compBalStart;
        uint256 aaveDelta = aaveAsset().erc20().balanceOf(address(this)) - aaveBalStart;
        if (compDelta > 0 || aaveDelta > 0) {
            emit RewardsClaimed(compDelta, aaveDelta);
        }

        _splitToTraders(compAsset(), compAsset().erc20().balanceOf(address(this)));
        _splitToTraders(aaveAsset(), aaveAsset().erc20().balanceOf(address(this)));
    }

    /// @return The timestamp of the next rewards event
    function nextRewards() public view override returns (uint256) {
        (, uint256 next) = _whenRewards(block.timestamp);
        return next;
    }

    // ==== Private ====

    /// Take a portion of backing collateral as profits and split to traders
    function _takeProfits() private {
        Fix amtBUs = basketUnits[address(this)];
        for (uint256 i = 0; i < _basket.size; i++) {
            uint256 found = _basket.collateral[i].erc20().balanceOf(address(this));
            // {qTok} = {qTok/BU} * {BU}
            uint256 required = _basket.quantity(_basket.collateral[i]).mul(amtBUs).ceil();
            if (found > required) {
                _splitToTraders(_basket.collateral[i], found - required);
            }
        }
    }

    /// Split `amount` of `asset` into cuts to send to revenue traders
    function _splitToTraders(IAsset asset, uint256 amount) private {
        if (amount > 0) {
            uint256 amtToRSR = rsrCut().mulu(amount).round();
            asset.erc20().safeTransfer(address(rsrTrader), amtToRSR); // cut
            asset.erc20().safeTransfer(address(rTokenTrader), amount - amtToRSR); // 1 - cut
        }
    }

    // Return the reward boundaries on either side of *time* as timestamps.
    function _whenRewards(uint256 time) private view returns (uint256 left, uint256 right) {
        int256 reps = (int256(time) - int256(rewardStart())) / int256(rewardPeriod());
        left = uint256(reps * int256(rewardPeriod()) + int256(rewardStart()));
        right = left + rewardPeriod();
    }
}
