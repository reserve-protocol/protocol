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

    function claimRewards(address mainAddr) internal {
        IMain main = IMain(mainAddr);
        ICollateral[] memory collateral = main.basketCollateral();
        for (uint256 i = 0; i < collateral.length; i++) {
            IClaimAdapter claimAdapter = collateral[i].claimAdapter();

            if (address(claimAdapter) == address(0)) continue;

            require(main.isTrustedClaimAdapter(claimAdapter), "claim adapter is not trusted");

            (address _to, bytes memory _calldata) = claimAdapter.getClaimCalldata(collateral[i]);

            if (_to != address(0)) {
                _to.functionCall(_calldata, "rewards claim failed");
            }
        }
    }
}
