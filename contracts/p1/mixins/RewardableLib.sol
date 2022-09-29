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
 * @notice A library that allows a contract to claim rewards
 * @dev The caller must implement the IRewardable interface!
 */
abstract contract RewardableLibP1 is IRewardable {
    using AddressUpgradeable for address;
    using SafeERC20Upgradeable for IERC20Upgradeable;

    struct Claim {
        IERC20 reward;
        address callTo;
        bytes _calldata;
    }

    /// Claim all rewards and sweep to BackingManager
    /// Collective Action
    /// @custom:interaction mostly CEI but see comments
    // where:
    //   this: the contract from which this function is being delegateCall'dd
    //   claims = {{rewardToken: erc20.rewardERC20(), to, calldata}
    //     for erc20 in assetRegistry
    //     where (to, calldata) = erc20.getClaimCalldata(){caller: this}
    //     if to != 0 and rewardToken in assetRegistry}
    //   rewards = {claim.rewardToken for claim in claims}
    // actions:
    //   first, do to.functionCall(calldata) for claim in claims
    //   then, if this is not backingManager
    //     then do
    //       reward.transfer(bal, backingManager) for claim in claims if bal > 0
    //       where reward = claim.reward and bal = reward.balanceOf(this)
    function _claimAndSweepRewards() internal {
        IAssetRegistry reg = assetRegistry();
        IERC20[] memory erc20s = reg.erc20s();

        IERC20[] memory rewardTokens = new IERC20[](erc20s.length);
        uint256 numRewardTokens = 0;

        Claim[] memory claims = new Claim[](erc20s.length);
        uint256 numClaims = 0;

        // Compute the interactions to have...
        for (uint256 i = 0; i < erc20s.length; ++i) {
            // Does erc20s[i] _have_ a reward function and reward token?
            IAsset asset = reg.toAsset(erc20s[i]);

            IERC20 rewardToken = asset.rewardERC20();
            if (address(rewardToken) == address(0) || !reg.isRegistered(rewardToken)) continue;

            (address _to, bytes memory _calldata) = asset.getClaimCalldata();
            if (_to == address(0)) continue;

            // Save Claim
            claims[numClaims] = Claim({ reward: rewardToken, callTo: _to, _calldata: _calldata });
            ++numClaims;

            // Save rewardToken address, if new
            uint256 rtIndex = 0;
            while (rtIndex < numRewardTokens && rewardToken != rewardTokens[rtIndex]) rtIndex++;
            if (rtIndex >= numRewardTokens) {
                rewardTokens[rtIndex] = rewardToken;
                numRewardTokens++;
            }
        }

        // == Interactions ==
        // Claim rewards
        for (uint256 i = 0; i < numClaims; i++) {
            // Safe violation of strict CEI: we're reading balanceOf() here, but oldBal and newBal
            // are only used here to emit the right event. Their definitions don't leave the inner
            // block of this loop.
            uint256 oldBal = claims[i].reward.balanceOf(address(this));
            claims[i].callTo.functionCall(claims[i]._calldata, "rewards claim failed");
            uint256 newBal = claims[i].reward.balanceOf(address(this));

            emit RewardsClaimed(address(claims[i].reward), newBal - oldBal);
        }

        // Sweep reward tokens to the backingManager
        if (address(this) != address(backingManager())) {
            for (uint256 i = 0; i < numRewardTokens; ++i) {
                // Safe violation of strict CEI: we're reading balanceOf() here, too, but it's
                // actually our intention to sweep all of rewardTokens[i] at this point, regardless
                // of whatever else we may have computed in the function above.
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
