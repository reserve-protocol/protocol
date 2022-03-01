// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "contracts/p0/interfaces/IRewardable.sol";
import "contracts/p0/Component.sol";

/**
 * @title Rewardable
 * @notice A mix-in that makes a contract able to claim rewards
 */
abstract contract RewardableP0 is Component, IRewardable {
    using Address for address;
    using SafeERC20 for IERC20Metadata;

    /// Claim all rewards and sweep to BackingManager
    function claimAndSweepRewards() external override {
        IClaimAdapter[] memory adapters = main.claimAdapters();

        // Cache initial reward token balances
        uint256[] memory initialBals = new uint256[](adapters.length);
        for (uint256 i = 0; i < adapters.length; i++) {
            initialBals[i] = adapters[i].rewardERC20().balanceOf(address(this));
        }

        // Claim rewards for all registered collateral
        IAssetRegistry reg = main.assetRegistry();
        IERC20Metadata[] memory erc20s = reg.registeredERC20s();
        for (uint256 i = 0; i < erc20s.length; i++) {
            if (!reg.toAsset(erc20s[i]).isCollateral()) continue;

            if (address(reg.toColl(erc20s[i]).claimAdapter()) == address(0)) continue;

            IClaimAdapter adapter = reg.toColl(erc20s[i]).claimAdapter();

            // TODO Confirm require here, as opposed to continue
            require(main.isTrustedClaimAdapter(adapter), "claim adapter is not trusted");

            (address _to, bytes memory _calldata) = adapter.getClaimCalldata(erc20s[i]);

            if (_to != address(0)) {
                _to.functionCall(_calldata, "rewards claim failed");
            }
        }

        // Sweep + emit events
        for (uint256 i = 0; i < adapters.length; i++) {
            IERC20Metadata erc20 = adapters[i].rewardERC20();
            uint256 bal = erc20.balanceOf(address(this));
            emit RewardsClaimed(address(erc20), bal - initialBals[i]);

            if (address(this) != address(main.backingManager()) && bal > 0) {
                erc20.safeTransfer(address(main.backingManager()), bal);
            }
        }
    }
}
