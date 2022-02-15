// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/libraries/Fixed.sol";
import "contracts/test/ProtoState.sol";

/// Provides three types of equality comparison:
///   1. uint
///   2. str
///   3. ProtoState
library Lib {
    /// uint version
    /// @param str A human-readable prefix to accompany the error message
    function assertEq(
        uint256 a,
        uint256 b,
        string memory str
    ) internal pure {
        if (a != b) {
            revert(string(abi.encodePacked(str, " | ", a, " != ", b)));
        }
    }

    /// str version
    /// @param str A human-readable prefix to accompany the error message
    function assertEq(
        string memory a,
        string memory b,
        string memory str
    ) internal pure {
        if (keccak256(bytes(a)) != keccak256(bytes(b))) {
            revert(string(abi.encodePacked(str, " | ", a, " != ", b)));
        }
    }

    /// Fix version
    /// @param str A human-readable prefix to accompany the error message
    function assertEq(
        Fix a,
        Fix b,
        string memory str
    ) internal pure {
        if (!FixLib.eq(a, b)) {
            revert(string(abi.encodePacked(str, " | ", a, " != ", b)));
        }
    }

    /// ProtoState version
    /// Compares ProtoStates for equality
    function assertEq(ProtoState memory a, ProtoState memory b) internal pure {
        assertConfigEq(a.config, b.config);
        assertDistEq(a.distribution, b.distribution);
        assertTokenStateEq(a.rToken, b.rToken, "RToken");
        assertTokenStateEq(a.stRSR, b.stRSR, "StRSR");
        assertBasketStateEq(a.basket, b.basket);
        assertOraclePriceEq(a.ethPrice, b.ethPrice, "ETH");
        assertFixArraysEq(a.rateToRef, b.rateToRef);
        assertEq(a.assets.length, b.assets.length, "asset length mismatch");

        // Assets
        for (uint256 i = 0; i < a.assets.length; i++) {
            assertTokenStateEq(a.assets[i], b.assets[i], a.assets[i].symbol);
        }
    }

    function assertConfigEq(Config memory a, Config memory b) internal pure {
        assertEq(a.rewardStart, b.rewardStart, "Config.rewardStart");
        assertEq(a.rewardPeriod, b.rewardPeriod, "Config.rewardStart");
        assertEq(a.auctionPeriod, b.auctionPeriod, "Config.rewardStart");
        assertEq(a.stRSRWithdrawalDelay, b.stRSRWithdrawalDelay, "Config.rewardStart");
        assertEq(a.defaultDelay, b.defaultDelay, "Config.rewardStart");
        assertEq(rawFix(a.maxTradeSlippage), rawFix(b.maxTradeSlippage), "Config.maxTradeSlippage");
        assertEq(rawFix(a.maxAuctionSize), rawFix(b.maxAuctionSize), "Config.maxAuctionSize");
        assertEq(rawFix(a.minAuctionSize), rawFix(b.minAuctionSize), "Config.minAuctionSize");
        assertEq(rawFix(a.issuanceRate), rawFix(b.issuanceRate), "Config.issuanceRate");
        assertEq(rawFix(a.defaultThreshold), rawFix(b.defaultThreshold), "Config.defaultThreshold");
    }

    function assertDistEq(RevenueDestination[] memory a, RevenueDestination[] memory b)
        internal
        pure
    {
        assertEq(a.length, b.length, "Revenue Dest length");
        assertNoRepeatedKeys(a);
        assertNoRepeatedKeys(b);
        for (uint256 i = 0; i < a.length; i++) {
            bool keyFound = false;
            for (uint256 j = 0; j < b.length; j++) {
                if (b[j].dest == a[i].dest) {
                    keyFound = true;
                    assertEq(a[i].rTokenDist, b[j].rTokenDist, "RToken distributions");
                    assertEq(a[i].rsrDist, b[j].rsrDist, "RSR distributions");
                    break;
                }
            }
            if (!keyFound) {
                revert(string(abi.encodePacked("No key in b matching ", a[i].dest)));
            }
        }
    }

    function assertNoRepeatedKeys(RevenueDestination[] memory a) internal pure {
        for (uint256 i = 0; i < a.length - 1; i++) {
            for (uint256 j = i + 1; j < a.length; j++) {
                if (a[i].dest == a[j].dest) {
                    revert(string(abi.encodePacked("Equal keys ", a[i].dest)));
                }
            }
        }
    }

    function assertTokenStateEq(
        TokenState memory a,
        TokenState memory b,
        string memory symbol
    ) internal pure {
        assertEq(a.name, b.name, "Name mismatch");
        assertEq(a.symbol, b.symbol, "Symbol mismatch");
        assertEq(a.symbol, symbol, "Symbol unexpected");
        assertEq(a.totalSupply, b.totalSupply, "TotalSupply mismatch");
        assertUintArrayEq(a.balances, b.balances);
    }

    function assertUintArrayEq(uint256[] memory a, uint256[] memory b) internal pure {
        assertEq(a.length, b.length, "uint[] length mismatch");
        for (uint256 i = 0; i < a.length; i++) {
            assertEq(a[i], b[i], string(abi.encodePacked("Account ", i, " uint mismatch")));
        }
    }

    function assertFixArraysEq(Fix[] memory a, Fix[] memory b) internal pure {
        assertEq(a.length, b.length, "fix array length mismatch");
        for (uint256 i = 0; i < a.length; i++) {
            assertEq(a[i], b[i], string(abi.encodePacked("index ", i, " mismatch")));
        }
    }

    function assertAssetNamesEq(AssetName[] memory a, AssetName[] memory b) internal pure {
        assertEq(a.length, b.length, "length mismatch");
        for (uint256 i = 0; i < a.length; i++) {
            if (a[i] != b[i]) {
                revert(string(abi.encodePacked("AssetNames", " | ", a, " != ", b)));
            }
        }
    }

    function assertBasketStateEq(BasketState memory a, BasketState memory b) internal pure {
        assertEq(a.maxSize, b.maxSize, "basket maxSize");
        assertAssetNamesEq(a.backing, b.backing);
        assertAssetNamesEq(a.backupCollateral, b.backupCollateral);
        assertUintArrayEq(a.qTokAmts, b.qTokAmts);
        assertFixArraysEq(a.refAmts, b.refAmts);
        assertFixArraysEq(a.targetAmts, b.targetAmts);
    }

    function assertOraclePriceEq(
        Price memory a,
        Price memory b,
        string memory str
    ) internal pure {
        assertEq(a.inETH, b.inETH, string(abi.encodePacked(str, ".price.inETH")));
        assertEq(a.inUoA, b.inUoA, string(abi.encodePacked(str, ".price.inUoA")));
    }

    function rawFix(Fix fix) internal pure returns (uint256) {
        return uint256(int256(Fix.unwrap(fix)));
    }
}
