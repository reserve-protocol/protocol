// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/p0/interfaces/IMain.sol";

library RewardsLib {
    /// @dev DANGER: delegatecall usage
    function claimAndSweepRewardsAllCollateral(address mainAddr) internal {
        IMain main = IMain(mainAddr);
        ICollateral[] memory collateral = main.basketCollateral();
        for (uint256 i = 0; i < collateral.length; i++) {
            // solhint-disable-next-line avoid-low-level-calls
            (bool success, ) = address(collateral[i]).delegatecall(
                abi.encodeWithSignature(
                    "claimAndSweepRewards(address,address)",
                    address(collateral[i]),
                    address(main)
                )
            );
            require(success, "delegatecall rewards claim failed");
        }
    }
}
