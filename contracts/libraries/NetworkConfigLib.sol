// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

/**
 * @title NetworkConfigLib
 * @notice Provides network-specific configuration parameters
 */
library NetworkConfigLib {
    error InvalidNetwork();

    // Returns the blocktime based on the current network (e.g. 12s for Ethereum PoS)
    // See docs/system-design.md for discussion of handling longer or shorter times
    function blocktime() internal view returns (uint48) {
        uint256 chainId = block.chainid;
        // untestable:
        //    most of the branches will be shown as uncovered, because we only run coverage
        //    on local Ethereum PoS network (31337). Manual testing was performed.
        if (chainId == 1 || chainId == 3 || chainId == 5 || chainId == 31337) {
            return 12; // Ethereum PoS, Goerli, HH (tests)
        } else if (chainId == 8453 || chainId == 84531) {
            return 2; // Base, Base Goerli
        } else {
            revert InvalidNetwork();
        }
    }
}
