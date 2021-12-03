// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "contracts/p0/assets/collateral/ATokenCollateralP0.sol";
import "contracts/p0/libraries/Oracle.sol";
import "contracts/p0/main/SettingsHandlerP0.sol";
import "contracts/p0/main/VaultHandlerP0.sol";
import "contracts/p0/main/MoodyP0.sol";
import "contracts/p0/main/Mixin.sol";
import "contracts/p0/interfaces/IAsset.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/interfaces/IVault.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/Pausable.sol";
import "./AuctioneerP0.sol";
import "./MoodyP0.sol";
import "./SettingsHandlerP0.sol";
import "./VaultHandlerP0.sol";

/**
 * @title RevenueHandler
 * @notice Handles claiming of rewards from other protocols.
 */
contract RevenueHandlerP0 is
    Pausable,
    Mixin,
    MoodyP0,
    SettingsHandlerP0,
    VaultHandlerP0,
    AuctioneerP0,
    IRevenueHandler
{
    using EnumerableSet for EnumerableSet.AddressSet;
    using SafeERC20 for IERC20;
    using FixLib for Fix;

    // TODO: make this uint256 _whenLastRewardClaimed
    mapping(uint256 => bool) private _rewardsClaimed;

    function init(ConstructorArgs calldata args)
        public
        virtual
        override(Mixin, SettingsHandlerP0, VaultHandlerP0, AuctioneerP0)
    {
        super.init(args);
    }

    /// Collects revenue by expanding RToken supply and claiming COMP/AAVE rewards
    function poke() public virtual override(Mixin, AuctioneerP0) notPaused {
        super.poke();
        (uint256 prevRewards, ) = _rewardsAdjacent(block.timestamp);
        if (!_rewardsClaimed[prevRewards] && fullyCapitalized()) {
            _handleComp();
            _handleAave();
            _expandSupplyToRTokenTrader();
            _rewardsClaimed[prevRewards] = true;
        }
    }

    /// @return The timestamp of the next rewards event
    function nextRewards() public view override returns (uint256) {
        (, uint256 next) = _rewardsAdjacent(block.timestamp);
        return next;
    }

    /// Claims COMP from all possible sources and splits earnings across revenue traders
    function _handleComp() internal {
        // Self
        oracle().compound.claimComp(address(this));

        // Current vault
        oracle().compound.claimComp(address(vault));
        vault.sweepNonBackingTokenToMain(compAsset().erc20());

        // Past vaults
        for (uint256 i = 0; i < pastVaults.length; i++) {
            uint256 bal = compAsset().erc20().balanceOf(address(pastVaults[i]));
            if (bal > 0) {
                oracle().compound.claimComp(address(pastVaults[i]));
                pastVaults[i].sweepNonBackingTokenToMain(compAsset().erc20());
            }
        }

        _splitRewardsToTraders(compAsset());
    }

    /// Claims AAVE from all possible sources and splits earnings across revenue traders
    function _handleAave() internal {
        for (uint256 i = 0; i < _allAssets.length(); i++) {
            if (IAsset(_allAssets.at(i)).isAToken()) {
                IStaticAToken aToken = IStaticAToken(address(IAsset(_allAssets.at(i)).erc20()));
                IAaveIncentivesController aic = aToken.INCENTIVES_CONTROLLER();
                address[] memory underlyings = new address[](1);
                underlyings[0] = aToken.ATOKEN().UNDERLYING_ASSET_ADDRESS();

                // Self
                uint256 bal = aic.getRewardsBalance(underlyings, address(this));
                aic.claimRewardsOnBehalf(underlyings, bal, address(this), address(this));

                // Current vault
                bal = aic.getRewardsBalance(underlyings, address(vault));
                if (bal > 0) {
                    vault.setMainAsAaveClaimer(aic);
                    aic.claimRewardsOnBehalf(underlyings, bal, address(vault), address(this));
                }

                // Past vaults
                for (uint256 j = 0; j < pastVaults.length; j++) {
                    bal = aic.getRewardsBalance(underlyings, address(pastVaults[j]));
                    if (bal > 0) {
                        pastVaults[j].setMainAsAaveClaimer(aic);
                        aic.claimRewardsOnBehalf(
                            underlyings,
                            bal,
                            address(pastVaults[j]),
                            address(this)
                        );
                    }
                }
            }
        }

        _splitRewardsToTraders(aaveAsset());
    }

    function _expandSupplyToRTokenTrader() internal {
        // Expand the RToken supply to self
        uint256 possible = fromBUs(vault.basketUnits(address(this)));
        uint256 totalSupply = rToken().totalSupply();
        if (fullyCapitalized() && possible > totalSupply) {
            rToken().mint(address(rTokenMeltingTrader), possible - totalSupply);
        }
    }

    /// Splits `asset` into `cut` and `1-cut` proportions, and sends to revenue traders
    function _splitRewardsToTraders(IAsset asset) private {
        uint256 bal = asset.erc20().balanceOf(address(this));
        uint256 amtToRSR = rsrCut().mulu(bal).toUint();
        asset.erc20().safeTransfer(address(rsrStakingTrader), amtToRSR); // cut
        asset.erc20().safeTransfer(address(rTokenMeltingTrader), bal - amtToRSR); // 1 - cut
    }

    // Returns the rewards boundaries on either side of *time*.
    function _rewardsAdjacent(uint256 time) private view returns (uint256 left, uint256 right) {
        int256 reps = (int256(time) - int256(rewardStart())) / int256(rewardPeriod());
        left = uint256(reps * int256(rewardPeriod()) + int256(rewardStart()));
        right = left + rewardPeriod();
    }
}
