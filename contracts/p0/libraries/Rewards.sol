// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "contracts/p0/interfaces/IClaimAdapter.sol";
import "contracts/p0/interfaces/IMain.sol";

library RewardsLib {
    using Address for address;
    using SafeERC20 for IERC20Metadata;

    /// @return rewardERC20s The reward ERC20s
    /// @return amtsClaimed The amounts claimed for each reward ERC20
    function claimRewards(IMain main)
        internal
        returns (IERC20Metadata[] memory rewardERC20s, uint256[] memory amtsClaimed)
    {
        IClaimAdapter[] memory adapters = main.claimAdapters();

        // Cache initial reward token balances
        rewardERC20s = new IERC20Metadata[](adapters.length);
        amtsClaimed = new uint256[](adapters.length);
        for (uint256 i = 0; i < adapters.length; i++) {
            rewardERC20s[i] = adapters[i].rewardERC20();
            amtsClaimed[i] = rewardERC20s[i].balanceOf(address(this));
        }

        // Claim rewards for all registered collateral
        IERC20Metadata[] memory erc20s = main.registeredERC20s();
        for (uint256 i = 0; i < erc20s.length; i++) {
            if (!main.toAsset(erc20s[i]).isCollateral()) continue;

            if (address(main.toColl(erc20s[i]).claimAdapter()) == address(0)) continue;

            IClaimAdapter adapter = main.toColl(erc20s[i]).claimAdapter();

            // TODO Confirm require here, as opposed to continue
            require(main.isTrustedClaimAdapter(adapter), "claim adapter is not trusted");

            (address _to, bytes memory _calldata) = adapter.getClaimCalldata(erc20s[i]);

            if (_to != address(0)) {
                _to.functionCall(_calldata, "rewards claim failed");
            }
        }

        // Subtract initial balances out
        for (uint256 i = 0; i < rewardERC20s.length; i++) {
            amtsClaimed[i] = rewardERC20s[i].balanceOf(address(this)) - amtsClaimed[i];
        }
    }
}
