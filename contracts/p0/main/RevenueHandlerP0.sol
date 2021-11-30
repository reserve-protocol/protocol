pragma solidity 0.8.9;
// SPDX-License-Identifier: BlueOak-1.0.0

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/p0/assets/collateral/ATokenCollateralP0.sol";
import "contracts/p0/main/SettingsHandlerP0.sol";
import "contracts/p0/main/VaultHandlerP0.sol";
import "contracts/p0/main/MoodyP0.sol";
import "contracts/p0/main/Mixin.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/Pausable.sol";
import "./MoodyP0.sol";
import "./SettingsHandlerP0.sol";
import "./VaultHandlerP0.sol";

/**
 * @title RevenueHandler
 * @notice Handles claiming of rewards from other protocols.
 */
contract RevenueHandlerP0 is Pausable, Mixin, MoodyP0, SettingsHandlerP0, VaultHandlerP0, IRevenueHandler {
    using SafeERC20 for IERC20;

    // timestamp -> whether rewards have been claimed.
    mapping(uint256 => bool) private _rewardsClaimed;

    function init(ConstructorArgs calldata args) public virtual override(Mixin, SettingsHandlerP0, VaultHandlerP0) {
        super.init(args);
    }

    /// Collects revenue by expanding RToken supply and claiming COMP/AAVE rewards
    function poke() public virtual override notPaused calm {
        super.poke();
        (uint256 prevRewards, ) = _rewardsAdjacent(block.timestamp);
        if (!_rewardsClaimed[prevRewards]) {
            _doRewards();
            _rewardsClaimed[prevRewards] = true;
        }
    }

    /// @return The timestamp of the next rewards event
    function nextRewards() public view override returns (uint256) {
        (, uint256 next) = _rewardsAdjacent(block.timestamp);
        return next;
    }

    /// Claims COMP + AAVE for self and vault, and sweeps into self
    function _doRewards() private {
        // Comp
        comptroller().claimComp(address(this));
        comptroller().claimComp(address(vault));
        vault.sweepToken(address(compAsset()));

        // Aave
        for (uint256 i = 0; i < vault.size(); i++) {
            if (vault.collateralAt(i).isAToken()) {
                // TODO: Write logic to permit Aave claims. We don't want to use `claimRewardsToSelf()` anymore
                IStaticAToken(address(vault.collateralAt(i).erc20())).claimRewardsToSelf(true);
                IStaticAToken(address(vault.collateralAt(i).erc20())).claimRewardsToSelf(true);
            }
        }
        vault.sweepToken(address(aaveAsset()));

        // Expand the RToken supply to self
        uint256 possible = fromBUs(vault.basketUnits(address(this)));
        uint256 totalSupply = rToken().totalSupply();
        if (fullyCapitalized() && possible > totalSupply) {
            rToken().mint(address(this), possible - totalSupply);
        }
    }

    // Returns the rewards boundaries on either side of *time*.
    function _rewardsAdjacent(uint256 time) private view returns (uint256 left, uint256 right) {
        int256 reps = (int256(time) - int256(rewardStart())) / int256(rewardPeriod());
        left = uint256(reps * int256(rewardPeriod()) + int256(rewardStart()));
        right = left + rewardPeriod();
    }
}
