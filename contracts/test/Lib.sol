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
    ) internal view returns (bool) {
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
    ) internal view returns (bool) {
        if (keccak256(bytes(a)) != keccak256(bytes(b))) {
            revert(string(abi.encodePacked(str, " | ", a, " != ", b)));
        }
        return true;
    }

    /// ProtoState version
    /// Compares ProtoStates for equality
    function assertEq(ProtoState memory a, ProtoState memory b) internal returns (bool ok) {
        ok =
            _assertConfigEq(a.config, b.config) &&
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
            ok = ok && _assertTokenStateEq(a.collateral[i], b.collateral[i], a.collateral[i].symbol);
        }
    }

    /// @return Whether two Configs are equal
    function _assertConfigEq(Config memory a, Config memory b) internal returns (bool) {
        return
            assertEq(a.rewardStart, b.rewardStart, "Config.rewardStart") &&
            assertEq(a.rewardPeriod, b.rewardPeriod, "Config.rewardStart") &&
            assertEq(a.auctionPeriod, b.auctionPeriod, "Config.rewardStart") &&
            assertEq(a.stRSRWithdrawalDelay, b.stRSRWithdrawalDelay, "Config.rewardStart") &&
            assertEq(a.defaultDelay, b.defaultDelay, "Config.rewardStart") &&
            assertEq(_rawFix(a.maxTradeSlippage), _rawFix(b.maxTradeSlippage), "Config.maxTradeSlippage") &&
            assertEq(_rawFix(a.maxAuctionSize), _rawFix(b.maxAuctionSize), "Config.maxAuctionSize") &&
            assertEq(
                _rawFix(a.minRecapitalizationAuctionSize),
                _rawFix(b.minRecapitalizationAuctionSize),
                "Config.minRecapitalizationAuctionSize"
            ) &&
            assertEq(
                _rawFix(a.minRevenueAuctionSize),
                _rawFix(b.minRevenueAuctionSize),
                "Config.minRevenueAuctionSize"
            ) &&
            assertEq(_rawFix(a.migrationChunk), _rawFix(b.migrationChunk), "Config.migrationChunk") &&
            assertEq(_rawFix(a.issuanceRate), _rawFix(b.issuanceRate), "Config.issuanceRate") &&
            assertEq(_rawFix(a.defaultThreshold), _rawFix(b.defaultThreshold), "Config.defaultThreshold") &&
            assertEq(_rawFix(a.f), _rawFix(b.f), "Config.f");
    }

    /// @return ok Whether two TokenStates are equal, including checking balances for known accounts.
    function _assertTokenStateEq(
        TokenState memory a,
        TokenState memory b,
        string memory symbol
    ) internal view returns (bool ok) {
        ok =
            assertEq(a.name, b.name, "Name mismatch") &&
            assertEq(a.symbol, b.symbol, "Symbol mismatch") &&
            assertEq(a.totalSupply, b.totalSupply, "TotalSupply mismatch") &&
            _assertBalancesEq(a.balances, b.balances, a.symbol) &&
            _assertAllowancesEq(a.allowances, b.allowances, a.symbol) &&
            _assertOraclePriceEq(a.price, b.price, a.symbol);
    }

    /// @return ok Whether two balance arrays are equivalent
    function _assertBalancesEq(
        uint256[] memory a,
        uint256[] memory b,
        string memory symbol
    ) internal view returns (bool ok) {
        string memory message;
        ok = assertEq(a.length, b.length, "Balances length mismatch");
        for (uint256 i = 0; i < a.length; i++) {
            ok = ok && assertEq(a[i], b[i], string(abi.encodePacked("Account ", i, " balance mismatch")));
        }
    }

    /// @return ok Whether two 2d allowance mappings are equivalent
    function _assertAllowancesEq(
        uint256[][] memory a,
        uint256[][] memory b,
        string memory symbol
    ) internal view returns (bool ok) {
        string memory message;
        ok = assertEq(a.length, b.length, "Allowances length mismatch");
        for (uint256 i = 0; i < a.length; i++) {
            message = string(abi.encodeWithSignature("Allowances array ", i, " length mismatch"));
            ok = ok && assertEq(a[i].length, b[i].length, message);
            for (uint256 j = 0; j < a[i].length; j++) {
                message = string(abi.encodeWithSignature("Account ", i, ", spender ", j, " allowance mismatch"));
                ok = ok && assertEq(a[i][j], b[i][j], message);
            }
        }
    }

    /// @return ok Whether two BU sets are equal
    function _assertBUEq(BU memory a, BU memory b) internal view returns (bool ok) {
        ok =
            assertEq(a.tokens.length, b.tokens.length, "Tokens size mismatch") &&
            assertEq(a.quantities.length, b.quantities.length, "Quantities size mismatch") &&
            assertEq(a.tokens.length, a.quantities.length, "invalid input");

        for (uint256 i = 0; ok && i < a.quantities.length; i++) {
            // TODO: Do fuzzy check
            ok = assertEq(a.quantities[i], b.quantities[i], "BU quantities mismatch");
        }
    }

    /// @return Whether the oracle prices match or not
    function _assertOraclePriceEq(
        OraclePrice memory a,
        OraclePrice memory b,
        string memory str
    ) internal view returns (bool) {
        return
            assertEq(a.inETH, b.inETH, string(abi.encodePacked(str, ".price.inETH"))) &&
            assertEq(a.inUSD, b.inUSD, string(abi.encodePacked(str, ".price.inUSD")));
    }

    function _rawFix(Fix fix) internal pure returns (uint256) {
        return uint256(int256(Fix.unwrap(fix)));
    }
}
