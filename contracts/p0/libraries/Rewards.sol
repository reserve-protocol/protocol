// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/p0/assets/collateral/ATokenCollateral.sol";
import "contracts/p0/interfaces/IAsset.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/libraries/Oracle.sol";

library RewardsLib {
    using SafeERC20 for IERC20;

    /// Claims all COMP/AAVE and sends it to Main
    function claimAndSweepRewards(IMain main) internal returns (uint256 compAmt, uint256 aaveAmt) {
        Oracle.Info memory oracle = main.oracle();
        oracle.compound.claimComp(address(this));
        IAsset[] memory assets = main.allAssets();

        for (uint256 i = 0; i < assets.length; i++) {
            if (assets[i].isAToken()) {
                IStaticAToken aToken = IStaticAToken(address(assets[i].erc20()));
                if (aToken.getClaimableRewards(address(this)) > 0) {
                    aToken.claimRewardsToSelf(true);
                }
            }
        }

        compAmt = main.compAsset().erc20().balanceOf(address(this));
        if (compAmt > 0) {
            main.compAsset().erc20().safeTransfer(address(main), compAmt);
        }
        aaveAmt = main.aaveAsset().erc20().balanceOf(address(this));
        if (aaveAmt > 0) {
            main.aaveAsset().erc20().safeTransfer(address(main), aaveAmt);
        }
    }
}
