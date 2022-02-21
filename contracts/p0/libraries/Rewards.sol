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

    /// @return erc20s The reward ERC20s as addresses
    /// @return amtsClaimed The amounts claimed for each reward ERC20
    function claimRewards(address mainAddr)
        internal
        returns (address[] memory erc20s, uint256[] memory amtsClaimed)
    {
        IMain main = IMain(mainAddr);
        IClaimAdapter[] memory adapters = main.claimAdapters();

        // Cache initial reward token balances
        erc20s = new address[](adapters.length);
        amtsClaimed = new uint256[](adapters.length);
        for (uint256 i = 0; i < adapters.length; i++) {
            erc20s[i] = adapters[i].rewardERC20();
            amtsClaimed[i] = IERC20(adapters[i].rewardERC20()).balanceOf(address(this));
        }

        // Claim rewards for all collateral
        ICollateral[] memory collateral = main.basketCollateral();
        for (uint256 i = 0; i < collateral.length; i++) {
            if (address(collateral[i].claimAdapter()) == address(0)) continue;

            require(
                main.isTrustedClaimAdapter(collateral[i].claimAdapter()),
                "claim adapter is not trusted"
            );

            (address _to, bytes memory _calldata) = collateral[i].claimAdapter().getClaimCalldata(
                collateral[i]
            );

            if (_to != address(0)) {
                _to.functionCall(_calldata, "rewards claim failed");
            }
        }

        // Subtract initial balances out
        for (uint256 i = 0; i < erc20s.length; i++) {
            amtsClaimed[i] = IERC20Metadata(erc20s[i]).balanceOf(address(this)) - amtsClaimed[i];
        }
    }
}
