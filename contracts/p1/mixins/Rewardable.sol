// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/AddressUpgradeable.sol";
import "contracts/p1/mixins/Component.sol";
import "contracts/interfaces/IMain.sol";
import "contracts/interfaces/IRewardable.sol";

/**
 * @title Rewardable
 * @notice A mix-in that makes a contract able to claim rewards
 */
abstract contract RewardableP1 is ComponentP1, IRewardable {
    using AddressUpgradeable for address;
    using SafeERC20Upgradeable for IERC20Upgradeable;

    /// Claim all rewards and sweep to BackingManager
    /// Collective Action
    function claimAndSweepRewards() external {
        // Call state keepers before collective actions
        main.poke();

        IAssetRegistry reg = main.assetRegistry();
        IERC20[] memory erc20s = reg.erc20s();
        IERC20[] memory rewardTokens = new IERC20[](erc20s.length);
        uint256 numRewardTokens = 0;

        for (uint256 i = 0; i < erc20s.length; i++) {
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
        if (address(this) != address(main.backingManager())) {
            for (uint256 i = 0; i < numRewardTokens; i++) {
                uint256 bal = rewardTokens[i].balanceOf(address(this));
                if (bal > 0) {
                    IERC20Upgradeable(address(rewardTokens[i])).safeTransfer(
                        address(main.backingManager()),
                        bal
                    );
                }
            }
        }
    }
}
