// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "../../interfaces/IAssetRegistry.sol";
import "../../interfaces/IBackingManager.sol";

/**
 * @title RewardableLibP1
 * @notice A library that allows a contract to claim rewards
 * @dev The caller must implement the IRewardable interface!
 */
library RewardableLibP1 {
    using Address for address;
    using SafeERC20 for IERC20;

    // === Used by Traders + RToken ===

    /// Claim all rewards
    // actions:
    //   do asset.delegatecall(abi.encodeWithSignature("claimRewards()")) for asset in assets
    function claimRewards(IAssetRegistry reg) internal {
        Registry memory registry = reg.getRegistry();
        uint256 len = registry.assets.length;
        for (uint256 i = 0; i < len; ++i) {
            // Claim rewards via delegatecall
            address(registry.assets[i]).functionDelegateCall(
                abi.encodeWithSignature("claimRewards()"),
                "rewards claim failed"
            );
        }
    }

    /// Claim rewards for a single ERC20
    // actions:
    //   do asset.delegatecall(abi.encodeWithSignature("claimRewards()"))
    function claimRewardsSingle(IAsset asset) internal {
        // Claim rewards via delegatecall
        address(asset).functionDelegateCall(
            abi.encodeWithSignature("claimRewards()"),
            "rewards claim failed"
        );
    }
}
