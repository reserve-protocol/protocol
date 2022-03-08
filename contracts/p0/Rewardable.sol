// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "contracts/interfaces/IClaimAdapter.sol";
import "contracts/interfaces/IRewardable.sol";
import "contracts/p0/Component.sol";

/**
 * @title Rewardable
 * @notice A mix-in that makes a contract able to claim rewards
 */
abstract contract RewardableP0 is Component, IRewardable {
    using Address for address;
    using SafeERC20 for IERC20;

    /// Claim all rewards and sweep to BackingManager
    /// Collective Action
    function claimAndSweepRewards() external {
        // Call state keepers before collective actions
        main.poke();

        IAssetRegistry reg = main.assetRegistry();
        IERC20[] memory erc20s = reg.erc20s();
        IERC20[] memory rewardTokens = new IERC20[](erc20s.length);
        uint256 numRewardTokens;

        for (uint256 i = 0; i < erc20s.length; i++) {
            // Does erc20s[i] _have_ an adapter?
            IClaimAdapter adapter = reg.toAsset(erc20s[i]).claimAdapter();
            if (address(adapter) == address(0)) continue;

            IERC20 rewardToken = adapter.rewardERC20();

            // Save rewardToken address
            {
                uint256 rtIndex = 0;
                while (rtIndex < numRewardTokens && rewardToken != rewardTokens[rtIndex]) rtIndex++;
                if (rtIndex >= numRewardTokens) {
                    rewardTokens[rtIndex] = rewardToken;
                    numRewardTokens++;
                }
            }
            uint256 oldBal = rewardToken.balanceOf(address(this));

            // Claim reward
            (address _to, bytes memory _calldata) = adapter.getClaimCalldata(erc20s[i]);
            if (_to != address(0)) {
                _to.functionCall(_calldata, "rewards claim failed");
            }

            uint256 bal = rewardToken.balanceOf(address(this));
            emit RewardsClaimed(address(rewardToken), bal - oldBal);
        }

        if (address(this) != address(main.backingManager())) {
            for (uint256 i = 0; i < numRewardTokens; i++) {
                uint256 bal = rewardTokens[i].balanceOf(address(this));
                if (bal > 0) {
                    rewardTokens[i].safeTransfer(address(main.backingManager()), bal);
                }
            }
        }
    }
}
