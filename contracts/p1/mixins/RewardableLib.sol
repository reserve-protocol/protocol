// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/AddressUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/interfaces/IAssetRegistry.sol";
import "contracts/interfaces/IBackingManager.sol";
import "contracts/interfaces/IRewardable.sol";

/**
 * @title RewardableLibP1
 * @notice An library that allows a contract to claim rewards
 * @dev The caller must implement the IRewardable interface!
 */
library RewardableLibP1 {
    using AddressUpgradeable for address;
    using SafeERC20Upgradeable for IERC20Upgradeable;

    /// Redefines event for when rewards are claimed, to be able to emit from library
    event RewardsClaimed(address indexed erc20, uint256 indexed amount);

    /// Claim all rewards and sweep to BackingManager
    /// Collective Action
    /// @custom:interaction
    function claimAndSweepRewards() external {
        IAssetRegistry reg = assetRegistry();
        IERC20[] memory erc20s = reg.erc20s();
        IERC20[] memory rewardTokens = new IERC20[](erc20s.length);
        uint256 numRewardTokens = 0;

        for (uint256 i = 0; i < erc20s.length; ++i) {
            // Does erc20s[i] _have_ a reward function and reward token?
            IAsset asset = reg.toAsset(erc20s[i]);

            IERC20 rewardToken = asset.rewardERC20();
            if (address(rewardToken) == address(0) || !reg.isRegistered(rewardToken)) continue;

            (address _to, bytes memory _calldata) = asset.getClaimCalldata();
            if (_to == address(0)) continue;

            // Save rewardToken address, if new
            uint256 rtIndex = 0;
            while (rtIndex < numRewardTokens && rewardToken != rewardTokens[rtIndex]) rtIndex++;
            if (rtIndex >= numRewardTokens) {
                rewardTokens[rtIndex] = rewardToken;
                numRewardTokens++;
            }

            // Claim reward
            uint256 oldBal = rewardToken.balanceOf(address(this));

            _to.functionCall(_calldata, "rewards claim failed");

            uint256 bal = rewardToken.balanceOf(address(this));

            emit RewardsClaimed(address(rewardToken), bal - oldBal);
        }

        // Sweep reward tokens to the backingManager
        if (address(this) != address(backingManager())) {
            for (uint256 i = 0; i < numRewardTokens; ++i) {
                uint256 bal = rewardTokens[i].balanceOf(address(this));
                if (bal > 0) {
                    IERC20Upgradeable(address(rewardTokens[i])).safeTransfer(
                        address(backingManager()),
                        bal
                    );
                }
            }
        }
    }

    /// @return The AssetRegistry
    function assetRegistry() private view returns (IAssetRegistry) {
        return IRewardable(address(this)).main().assetRegistry();
    }

    /// @return The BackingManager
    function backingManager() private view returns (IBackingManager) {
        return IRewardable(address(this)).main().backingManager();
    }
}
