// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/AddressUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/interfaces/IAssetRegistry.sol";
import "contracts/interfaces/IBackingManager.sol";
import "contracts/interfaces/IRewardable.sol";
import "contracts/interfaces/IRToken.sol";

/**
 * @title RewardableLibP1
 * @notice An library that allows a contract to claim rewards
 * @dev The caller must implement the IRewardable interface!
 */
library RewardableLibP1 {
    using AddressUpgradeable for address;
    using SafeERC20Upgradeable for IERC20Upgradeable;

    // === Used by Traders + RToken ===

    /// Redefines event for when rewards are claimed, to be able to emit from library
    event RewardsClaimed(address indexed erc20, uint256 indexed amount);

    struct Claim {
        IERC20 reward;
        address callTo;
        bytes _calldata;
    }

    /// Claim all rewards
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
    //   do to.functionCall(calldata) for claim in claims
    function claimRewards() external {
        IAssetRegistry reg = IRewardable(address(this)).main().assetRegistry();
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
    }

    // ==== Used only by RToken ===

    /// Sweep all reward tokens in excess of liabilities to the BackingManager
    /// Caller must be the RToken
    /// @custom:interaction
    /// @param liabilities The storage mapping of liabilities by token
    /// @param reg The AssetRegistry
    /// @param bm The BackingManager
    function sweepRewards(
        mapping(IERC20 => uint256) storage liabilities,
        IAssetRegistry reg,
        IBackingManager bm
    ) external {
        IERC20[] memory erc20s = reg.erc20s();
        uint256 erc20sLen = erc20s.length;
        uint256[] memory deltas = new uint256[](erc20sLen); // {qTok}

        // Calculate deltas
        for (uint256 i = 0; i < erc20sLen; ++i) {
            deltas[i] = erc20s[i].balanceOf(address(this)) - liabilities[erc20s[i]]; // {qTok}
        }

        // == Interactions ==
        // Sweep deltas
        for (uint256 i = 0; i < erc20sLen; ++i) {
            IERC20Upgradeable(address(erc20s[i])).safeTransfer(address(bm), deltas[i]);
        }
    }
}
