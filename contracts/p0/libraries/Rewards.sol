// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/p0/interfaces/IMain.sol";

library RewardsLib {
    function claimAndSweepRewards(address mainAddr) internal {
        IMain main = IMain(mainAddr);
        IAsset[] memory assets = main.allAssets();
        for (uint256 i = 0; i < assets.length; i++) {
            // solhint-disable-next-line avoid-low-level-calls
            (bool success, ) = address(assets[i]).delegatecall(
                abi.encodeWithSignature(
                    "claimAndSweepRewards(address,address)",
                    address(assets[i]),
                    address(main)
                )
            );
            require(success, "delegatecall rewards claim failed");
        }
    }
}
