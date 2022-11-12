// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "contracts/interfaces/IAssetRegistry.sol";
import "contracts/interfaces/IBackingManager.sol";

/**
 * @title RewardableLibP1
 * @notice An library that allows a contract to claim rewards
 * @dev The caller must implement the IRewardable interface!
 */
library RewardableLibP1 {
    using Address for address;
    using SafeERC20 for IERC20;

    // === Used by Traders + RToken ===

    /// Claim all rewards
    /// @custom:interaction mostly CEI but see comments
    // actions:
    //   do asset.delegatecall(abi.encodeWithSignature("claimRewards()")) for asset in assets
    function claimRewards(IAssetRegistry reg) external {
        (, IAsset[] memory assets) = reg.getRegistry();
        for (uint256 i = 0; i < assets.length; ++i) {
            // Claim rewards via delegatecall
            address(assets[i]).functionDelegateCall(
                abi.encodeWithSignature("claimRewards()"),
                "rewards claim failed"
            );
        }
    }

    /// Claim rewards for a single ERC20
    /// @custom:interaction mostly CEI but see comments
    // actions:
    //   do asset.delegatecall(abi.encodeWithSignature("claimRewards()"))
    function claimRewardsSingle(IAsset asset) external {
        // Claim rewards via delegatecall
        address(asset).functionDelegateCall(
            abi.encodeWithSignature("claimRewards()"),
            "rewards claim failed"
        );
    }

    // ==== Used only by RToken ===

    /// Sweep all tokens in excess of liabilities to the BackingManager
    /// @custom:interaction
    /// @param liabilities The storage mapping of liabilities by token
    /// @param reg The AssetRegistry
    /// @param bm The BackingManager
    // actions:
    //   do erc20.safeTransfer(bm, bal - liabilities[erc20]) for erc20 in erc20s
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
            if (deltas[i] > 0) {
                erc20s[i].safeTransfer(address(bm), deltas[i]);

                // Verify nothing has gone wrong -- we should keep this assert, even in P1
                assert(erc20s[i].balanceOf(address(this)) >= liabilities[erc20s[i]]);
            }
        }
    }

    /// Sweep a ERC20 in excess of liabilities to the BackingManager
    /// @custom:interaction
    /// @param liabilities The storage mapping of liabilities by token
    /// @param erc20 The erc20 to sweep
    /// @param bm The BackingManager
    // actions:
    //   erc20.safeTransfer(bm, bal - liabilities[erc20]) if bal > liabilities[erc20]
    function sweepRewardsSingle(
        mapping(IERC20 => uint256) storage liabilities,
        IERC20 erc20,
        IBackingManager bm
    ) external {
        uint256 amt = erc20.balanceOf(address(this)) - liabilities[erc20];
        if (amt > 0) {
            erc20.safeTransfer(address(bm), amt);

            // Verify nothing has gone wrong -- we should keep this assert, even in P1
            assert(erc20.balanceOf(address(this)) >= liabilities[erc20]);
        }
    }
}
