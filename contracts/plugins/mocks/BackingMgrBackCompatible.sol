// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "../../p1/BackingManager.sol";

interface IBackingManagerComp {
    function manageTokens(IERC20[] memory erc20s) external;
}

// BackingManager compatible with version 2
contract BackingMgrCompatibleV2 is BackingManagerP1, IBackingManagerComp {
    function manageTokens(IERC20[] calldata erc20s) external notTradingPausedOrFrozen {
        // Mirror V3 logic (only the section relevant to tests)
        if (erc20s.length == 0) {
            this.rebalance(TradeKind.DUTCH_AUCTION);
        } else {
            this.forwardRevenue(erc20s);
        }
    }

    function version() public pure virtual override(Versioned, IVersioned) returns (string memory) {
        return "2.1.0";
    }
}

// BackingManager compatible with version 1
contract BackingMgrCompatibleV1 is BackingMgrCompatibleV2 {
    function version() public pure override(BackingMgrCompatibleV2) returns (string memory) {
        return "1.0.0";
    }
}

// BackingManager with invalid version
contract BackingMgrInvalidVersion is BackingMgrCompatibleV2 {
    function version() public pure override(BackingMgrCompatibleV2) returns (string memory) {
        return "0.0.0";
    }
}
