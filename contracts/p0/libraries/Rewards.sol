// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "contracts/p0/assets/ATokenCollateral.sol";
import "contracts/p0/interfaces/IAsset.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/interfaces/IOracle.sol";

library RewardsLib {
    using SafeERC20 for IERC20Metadata;

    /// Claims and sweeps rewards for all collateral tokens in the registry
    function claimAndSweepRewards(IMain main) internal {
        IAsset[] memory assets = main.allAssets();
        for (uint256 i = 0; i < assets.length; i++) {
            if (assets[i].isCollateral()) {
                _claimAndSweepRewardsForCollateral(main, ICollateral(address(assets[i])));
            }
        }
    }

    /// @return sweepAmt {qTok} How much of the reward token was swept
    function _claimAndSweepRewardsForCollateral(IMain main, ICollateral collateral)
        private
        returns (uint256 sweepAmt)
    {
        // TODO Move into assets? How? Caller has to be contract that earned it
        // if (collateral.oracleSource() == IOracle.AAVE) {
        //     IStaticAToken aToken = IStaticAToken(address(collateral.erc20()));
        //     sweepAmt = aToken.getClaimableRewards(address(this));
        //     if (sweepAmt > 0) {
        //         aToken.claimRewardsToSelf(true);
        //         main.aaveAsset().erc20().safeTransfer(address(main), sweepAmt);
        //     }
        // } else if (collateral.oracleSource() == IOracle.COMPOUND) {
        //     // `collateral` being unused here is expected
        //     // compound groups all rewards automatically
        //     main.oracle(UoA.USD).comptroller().claimComp(address(this));
        //     sweepAmt = main.compAsset().erc20().balanceOf(address(this));
        //     if (sweepAmt > 0) {
        //         main.compAsset().erc20().safeTransfer(address(main), sweepAmt);
        //     }
        // }
        return 0;
    }
}
