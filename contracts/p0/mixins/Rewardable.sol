// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/utils/Address.sol";
import "./Component.sol";
import "../../interfaces/IRewardable.sol";

/**
 * @title Rewardable
 * @notice A mix-in that makes a contract able to claim rewards
 */
abstract contract RewardableP0 is ComponentP0, IRewardableComponent {
    using Address for address;

    /// Claim all rewards
    /// Collective Action
    function claimRewards() external notTradingPausedOrFrozen {
        IAssetRegistry reg = main.assetRegistry();
        IERC20[] memory erc20s = reg.erc20s();

        for (uint256 i = 0; i < erc20s.length; i++) {
            IAsset asset = reg.toAsset(erc20s[i]);

            // Claim rewards via delegatecall
            address(asset).functionDelegateCall(
                abi.encodeWithSignature("claimRewards()"),
                "rewards claim failed"
            );
        }
    }

    /// Claim rewards for a single asset
    /// Collective Action
    /// @param erc20 The ERC20 to claimRewards on
    /// @custom:interaction CEI
    function claimRewardsSingle(IERC20 erc20) external notTradingPausedOrFrozen {
        IAsset asset = main.assetRegistry().toAsset(erc20);

        // Claim rewards via delegatecall
        address(asset).functionDelegateCall(
            abi.encodeWithSignature("claimRewards()"),
            "rewards claim failed"
        );
    }
}
