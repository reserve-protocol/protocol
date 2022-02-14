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
    /// @return Whether the uints match or not
    function assertEq(
        uint256 a,
        uint256 b,
        string memory str
    ) internal pure returns (bool) {
        if (a != b) {
            revert(string(abi.encodePacked(str, " | ", a, " != ", b)));
        }
        return true;
    }

    /// str version
    /// @param str A human-readable prefix to accompany the error message
    /// @return Whether the strings match or not
    function assertEq(
        string memory a,
        string memory b,
        string memory str
    ) internal pure returns (bool) {
        if (keccak256(bytes(a)) != keccak256(bytes(b))) {
            revert(string(abi.encodePacked(str, " | ", a, " != ", b)));
        }
        return true;
    }

    /// Fix version
    /// @param str A human-readable prefix to accompany the error message
    /// @return Whether the Fixes match or not
    function assertEq(
        Fix a,
        Fix b,
        string memory str
    ) internal pure returns (bool) {
        if (!FixLib.eq(a, b)) {
            revert(string(abi.encodePacked(str, " | ", a, " != ", b)));
        }
        return true;
    }

    /// ProtoState version
    /// Compares ProtoStates for equality
    function assertEq(ProtoState memory a, ProtoState memory b) internal pure returns (bool ok) {
        ok =
            _assertConfigEq(a.config, b.config) &&
            _assertDistEq(a.distribution, b.distribution) &&
            _assertBUEq(a.rTokenDefinition, b.rTokenDefinition) &&
            _assertTokenStateEq(a.rToken, b.rToken, "RToken") &&
            _assertTokenStateEq(a.rsr, b.rsr, "RSR") &&
            _assertTokenStateEq(a.stRSR, b.stRSR, "stRSR") &&
            _assertTokenStateEq(a.comp, b.comp, "COMP") &&
            _assertTokenStateEq(a.aave, b.aave, "AAVE") &&
            _assertOraclePriceEq(a.ethPrice, b.ethPrice, "ETH") &&
            assertEq(a.bu_s.length, b.bu_s.length, "Baskets size mismatch") &&
            assertEq(a.collateral.length, b.collateral.length, "Collateral length mismatch");

        // Baskets
        for (uint256 i = 0; ok && i < a.bu_s.length; i++) {
            ok = ok && _assertBUEq(a.bu_s[i], b.bu_s[i]);
        }

        // Collateral
        for (uint256 i = 0; ok && i < a.collateral.length; i++) {
            ok =
                ok &&
                _assertTokenStateEq(a.collateral[i], b.collateral[i], a.collateral[i].symbol);
        }
    }

    /// @return Whether two Configs are equal
    function _assertConfigEq(Config memory a, Config memory b) internal pure returns (bool) {
        return
            assertEq(a.rewardStart, b.rewardStart, "Config.rewardStart") &&
            assertEq(a.rewardPeriod, b.rewardPeriod, "Config.rewardStart") &&
            assertEq(a.auctionPeriod, b.auctionPeriod, "Config.rewardStart") &&
            assertEq(a.stRSRWithdrawalDelay, b.stRSRWithdrawalDelay, "Config.rewardStart") &&
            assertEq(a.defaultDelay, b.defaultDelay, "Config.rewardStart") &&
            assertEq(
                _rawFix(a.maxTradeSlippage),
                _rawFix(b.maxTradeSlippage),
                "Config.maxTradeSlippage"
            ) &&
            assertEq(_rawFix(a.dustAmount), _rawFix(b.dustAmount), "Config.dustAmount") &&
            assertEq(
                _rawFix(a.maxAuctionSize),
                _rawFix(b.maxAuctionSize),
                "Config.maxAuctionSize"
            ) &&
            assertEq(_rawFix(a.issuanceRate), _rawFix(b.issuanceRate), "Config.issuanceRate") &&
            assertEq(
                _rawFix(a.defaultThreshold),
                _rawFix(b.defaultThreshold),
                "Config.defaultThreshold"
            );
    }

    function _assertDistEq(RevenueDestination[] memory a, RevenueDestination[] memory b)
        internal
        pure
        returns (bool)
    {
        if (!assertEq(a.length, b.length, "Revenue Dest length")) {
            return false;
        }
        _assertNoRepeatedKeys(a);
        _assertNoRepeatedKeys(b);
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
        return true;
    }

    function _assertNoRepeatedKeys(RevenueDestination[] memory a) internal pure {
        for (uint256 i = 0; i < a.length - 1; i++) {
            for (uint256 j = i + 1; j < a.length; j++) {
                if (a[i].dest == a[j].dest) {
                    revert(string(abi.encodePacked("Equal keys ", a[i].dest)));
                }
            }
        }
    }

    /// @return ok Whether two TokenStates are equal, including checking balances for known accounts.
    function _assertTokenStateEq(
        TokenState memory a,
        TokenState memory b,
        string memory symbol
    ) internal pure returns (bool ok) {
        ok =
            assertEq(a.name, b.name, "Name mismatch") &&
            assertEq(a.symbol, b.symbol, "Symbol mismatch") &&
            assertEq(a.symbol, symbol, "Symbol unexpected") &&
            assertEq(a.totalSupply, b.totalSupply, "TotalSupply mismatch") &&
            _assertBalancesEq(a.balances, b.balances) &&
            _assertOraclePriceEq(a.price, b.price, a.symbol);
    }

    /// @return ok Whether two balance arrays are equivalent
    function _assertBalancesEq(uint256[] memory a, uint256[] memory b)
        internal
        pure
        returns (bool ok)
    {
        ok = assertEq(a.length, b.length, "Balances length mismatch");
        for (uint256 i = 0; i < a.length; i++) {
            ok =
                ok &&
                assertEq(a[i], b[i], string(abi.encodePacked("Account ", i, " balance mismatch")));
        }
    }

    /// // @return ok Whether two 2d allowance mappings are equivalent
    // Not currently used
    // function _assertAllowancesEq(
    //     uint256[][] memory a,
    //     uint256[][] memory b,
    //     string memory /* symbol */
    // ) internal pure returns (bool ok) {
    //     string memory message;
    //     ok = assertEq(a.length, b.length, "Allowances length mismatch");
    //     for (uint256 i = 0; i < a.length; i++) {
    //         message = string(abi.encodeWithSignature("Allowances array ", i, " length mismatch"));
    //         ok = ok && assertEq(a[i].length, b[i].length, message);
    //         for (uint256 j = 0; j < a[i].length; j++) {
    //             message = string(
    //                 abi.encodeWithSignature("Account ", i, ", spender ", j, " allowance mismatch")
    //             );
    //             ok = ok && assertEq(a[i][j], b[i][j], message);
    //         }
    //     }
    // }

    /// @return ok Whether two BU sets are equal
    function _assertBUEq(BU memory a, BU memory b) internal pure returns (bool ok) {
        ok =
            assertEq(a.assets.length, b.assets.length, "Tokens size mismatch") &&
            assertEq(a.refAmts.length, b.refAmts.length, "Portions size mismatch") &&
            assertEq(a.assets.length, a.refAmts.length, "invalid input");

        for (uint256 i = 0; ok && i < a.refAmts.length; i++) {
            ok = assertEq(a.refAmts[i], b.refAmts[i], "BU quantities mismatch");
        }
    }

    /// @return Whether the oracle prices match or not
    function _assertOraclePriceEq(
        Price memory a,
        Price memory b,
        string memory str
    ) internal pure returns (bool) {
        return
            assertEq(a.inETH, b.inETH, string(abi.encodePacked(str, ".price.inETH"))) &&
            assertEq(a.inUoA, b.inUoA, string(abi.encodePacked(str, ".price.inUoA")));
    }

    function _rawFix(Fix fix) internal pure returns (uint256) {
        return uint256(int256(Fix.unwrap(fix)));
    }
}
