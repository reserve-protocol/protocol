// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/utils/Address.sol";
import "contracts/p0/mixins/Component.sol";
import "contracts/interfaces/IRewardable.sol";

/**
 * @title Rewardable
 * @notice A mix-in that makes a contract able to claim rewards
 */
abstract contract RewardableP0 is ComponentP0, IRewardable {
    using Address for address;

    /// Claim all rewards
    /// Collective Action
    function claimRewards() external notPausedOrFrozen {
        main.poke();

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
}
