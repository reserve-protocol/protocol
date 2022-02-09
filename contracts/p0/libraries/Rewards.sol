// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "contracts/p0/interfaces/IClaimAdapter.sol";
import "contracts/p0/interfaces/IMain.sol";

library RewardsLib {
    using SafeERC20 for IERC20Metadata;

    function claimRewards(address mainAddr) internal {
        IMain main = IMain(mainAddr);
        ICollateral[] memory collateral = main.basketCollateral();
        for (uint256 i = 0; i < collateral.length; i++) {
            IClaimAdapter claimAdapter = main.claimAdapter();

            (address _to, bytes memory _calldata) = claimAdapter.getClaimCalldata(collateral[i]);

            if (_to != address(0)) {
                Address.functionCall(_to, _calldata, "rewards claim failed");
            }
        }
    }
}
