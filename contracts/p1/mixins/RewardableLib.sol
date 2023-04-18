// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

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

    event Complete();

    // === Used by Traders + RToken ===

    /// Claim all rewards
    /// @custom:interaction mostly CEI but see comments
    // actions:
    //   do asset.claimRewards() for asset in assets
    function claimRewards(IAssetRegistry reg) internal {
        Registry memory registry = reg.getRegistry();
        for (uint256 i = 0; i < registry.erc20s.length; ++i) {
            // empty try/catch because not every erc20 will be wrapped & have a claimRewards func
            // solhint-disable-next-line
            try IRewardable(address(registry.erc20s[i])).claimRewards() {} catch {}
        }
        // weird solidity compiler bug
        // requires something after the empty block so that the last try gets fired
        emit Complete();
    }

    /// Claim rewards for a single ERC20
    /// @custom:interaction mostly CEI but see comments
    // actions:
    //   do asset.claimRewards()
    function claimRewardsSingle(IAsset asset) internal {
        // empty try/catch because not every erc20 will be wrapped & have a claimRewards func
        // solhint-disable-next-line
        try IRewardable(address(asset.erc20())).claimRewards() {} catch {}
    }
}
