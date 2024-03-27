// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

interface ArbSys {
    function arbBlockNumber() external view returns (uint256);
}

ArbSys constant ARB_SYS = ArbSys(0x0000000000000000000000000000000000000064); // arb precompile

/**
 * @title NetworkConfigLib
 * @notice Provides network-specific configuration parameters
 */
library NetworkConfigLib {
    error InvalidNetwork();

    // Returns the blocktime based on the current network (e.g. 12s for Ethereum PoS)
    // See docs/system-design.md for discussion of handling longer or shorter times
    /// @dev Round up to 1 if block time <1s
    function blocktime() internal view returns (uint48) {
        uint256 chainId = block.chainid;
        // untestable:
        //    most of the branches will be shown as uncovered, because we only run coverage
        //    on local Ethereum PoS network (31337). Manual testing was performed.
        if (chainId == 1 || chainId == 3 || chainId == 5 || chainId == 31337) {
            return 12; // Ethereum PoS, Goerli, HH (tests)
        } else if (chainId == 8453 || chainId == 84531) {
            return 2; // Base, Base Goerli
        } else if (chainId == 42161 || chainId == 421614) {
            return 1; // round up to 1 even though Arbitrum is ~0.26s
        } else {
            revert InvalidNetwork();
        }
    }

    // Returns the current blocknumber based on the current network
    // Some L2s such as Arbitrum have special-cased their block number function
    function blockNumber() internal view returns (uint256) {
        // untestable:
        //    most of the branches will be shown as uncovered, because we only run coverage
        //    on local Ethereum PoS network (31337). Manual testing was performed.
        if (block.chainid == 42161 || block.chainid == 421614) {
            return ARB_SYS.arbBlockNumber(); // use arbitrum precompile
        } else {
            return block.number;
        }
    }
}
