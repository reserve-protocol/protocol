// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "../../p1/RevenueTrader.sol";

interface IRevenueTraderComp {
    function manageToken(IERC20 sell) external;
}

// RevenueTrader compatible with version 2
contract RevenueTraderCompatibleV2 is RevenueTraderP1, IRevenueTraderComp {
    function manageToken(IERC20 sell) external notTradingPausedOrFrozen {
        // Mirror V3 logic (only the section relevant to tests)
        this.manageToken(sell, TradeKind.DUTCH_AUCTION);
    }

    function version() public pure virtual override(Versioned, IVersioned) returns (string memory) {
        return "2.1.0";
    }
}

// RevenueTrader compatible with version 1
contract RevenueTraderCompatibleV1 is RevenueTraderCompatibleV2 {
    function version() public pure override(RevenueTraderCompatibleV2) returns (string memory) {
        return "1.0.0";
    }
}

// RevenueTrader with invalid version
contract RevenueTraderInvalidVersion is RevenueTraderCompatibleV2 {
    function version() public pure override(RevenueTraderCompatibleV2) returns (string memory) {
        return "0.0.0";
    }
}
