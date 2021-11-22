// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/libraries/Fixed.sol";
import "contracts/test/ProtoState.sol";

import "hardhat/console.sol";

/// Provides three types of equality comparison:
///   1. uint
///   2. str
///   3. ProtoState
library Lib {
    /// uint version
    /// @param str A human-readable prefix to accompany the error message
    /// @return Whether the uints match or not
    function eq(
        uint256 a,
        uint256 b,
        string memory str
    ) internal view returns (bool) {
        if (a != b) {
            console.log(string(abi.encodePacked(str, " | %s != %s")), a, b);
            return false;
        }
        return true;
    }

    /// str version
    /// @param str A human-readable prefix to accompany the error message
    /// @return Whether the strings match or not
    function eq(
        string memory a,
        string memory b,
        string memory str
    ) internal view returns (bool) {
        if (keccak256(bytes(a)) != keccak256(bytes(b))) {
            console.log(string(abi.encodePacked(str, " | %s != %s")), a, b);
            return false;
        }
        return true;
    }

    /// ProtoState version
    /// Compares ProtoStates for equality
    function eq(ProtoState memory a, ProtoState memory b) internal returns (bool ok) {
        ok =
            _eqConfig(a.config, b.config) &&
            _eqBU(a.rTokenDefinition, b.rTokenDefinition) &&
            _eqTokenState(a.rToken, b.rToken, "RToken") &&
            _eqTokenState(a.rsr, b.rsr, "RSR") &&
            _eqTokenState(a.stRSR, b.stRSR, "stRSR") &&
            _eqTokenState(a.comp, b.comp, "COMP") &&
            _eqTokenState(a.aave, b.aave, "AAVE") &&
            _eqOraclePrice(a.ethPrice, b.ethPrice) &&
            eq(a.bu_s.length, b.bu_s.length, "Baskets size mismatch") &&
            eq(a.collateral.length, b.collateral.length, "Collateral length mismatch");

        // Baskets
        for (uint256 i = 0; ok && i < a.bu_s.length; i++) {
            ok = ok && _eqBU(a.bu_s[i], b.bu_s[i]);
        }

        // Collateral
        for (uint256 i = 0; ok && i < a.collateral.length; i++) {
            ok = ok && _eqTokenState(a.collateral[i], b.collateral[i], a.collateral[i].symbol);
        }
    }

    /// @return Whether two Configs are equal
    function _eqConfig(Config memory a, Config memory b) internal returns (bool) {
        return
            eq(a.rewardStart, b.rewardStart, "Config.rewardStart") &&
            eq(a.rewardPeriod, b.rewardPeriod, "Config.rewardStart") &&
            eq(a.auctionPeriod, b.auctionPeriod, "Config.rewardStart") &&
            eq(a.stRSRWithdrawalDelay, b.stRSRWithdrawalDelay, "Config.rewardStart") &&
            eq(a.defaultDelay, b.defaultDelay, "Config.rewardStart") &&
            eq(_rawFix(a.maxTradeSlippage), _rawFix(b.maxTradeSlippage), "Config.maxTradeSlippage") &&
            eq(_rawFix(a.maxAuctionSize), _rawFix(b.maxAuctionSize), "Config.maxAuctionSize") &&
            eq(
                _rawFix(a.minRecapitalizationAuctionSize),
                _rawFix(b.minRecapitalizationAuctionSize),
                "Config.minRecapitalizationAuctionSize"
            ) &&
            eq(_rawFix(a.minRevenueAuctionSize), _rawFix(b.minRevenueAuctionSize), "Config.minRevenueAuctionSize") &&
            eq(_rawFix(a.migrationChunk), _rawFix(b.migrationChunk), "Config.migrationChunk") &&
            eq(_rawFix(a.issuanceRate), _rawFix(b.issuanceRate), "Config.issuanceRate") &&
            eq(_rawFix(a.defaultThreshold), _rawFix(b.defaultThreshold), "Config.defaultThreshold") &&
            eq(_rawFix(a.f), _rawFix(b.f), "Config.f");
    }

    /// @return ok Whether two TokenStates are equal, including checking balances for known accounts.
    function _eqTokenState(
        TokenState memory a,
        TokenState memory b,
        string memory symbol
    ) internal view returns (bool ok) {
        ok =
            eq(a.name, b.name, "Name mismatch") &&
            eq(a.symbol, b.symbol, "Symbol mismatch") &&
            eq(a.totalSupply, b.totalSupply, "TotalSupply mismatch") &&
            _eqBalances(a.balances, b.balances, a.symbol) &&
            _eqAllowances(a.allowances, b.allowances, a.symbol) &&
            _eqOraclePrice(a.price, b.price);
        if (!ok) {
            console.log("Token: %s", symbol);
        }
    }

    /// @return ok Whether two balance arrays are equivalent
    function _eqBalances(
        uint256[] memory a,
        uint256[] memory b,
        string memory symbol
    ) internal view returns (bool ok) {
        string memory message;
        ok = eq(a.length, b.length, "Balances length mismatch");
        for (uint256 i = 0; i < a.length; i++) {
            ok = ok && eq(a[i], b[i], string(abi.encodePacked("Account ", i, " balance mismatch")));
        }
        if (!ok) {
            console.log("Token: %s", symbol);
        }
    }

    /// @return ok Whether two 2d allowance mappings are equivalent
    function _eqAllowances(
        uint256[][] memory a,
        uint256[][] memory b,
        string memory symbol
    ) internal view returns (bool ok) {
        string memory message;
        ok = eq(a.length, b.length, "Allowances length mismatch");
        for (uint256 i = 0; i < a.length; i++) {
            message = string(abi.encodePacked("Allowances array ", i, " length mismatch"));
            ok = ok && eq(a[i].length, b[i].length, message);
            for (uint256 j = 0; j < a[i].length; j++) {
                message = string(abi.encodePacked("Account ", i, ", spender ", j, " allowance mismatch"));
                ok = ok && eq(a[i][j], b[i][j], message);
            }
        }
        if (!ok) {
            console.log("Token: %s", symbol);
        }
    }

    /// @return ok Whether two BU sets are equal
    function _eqBU(BU memory a, BU memory b) internal view returns (bool ok) {
        ok =
            eq(a.tokens.length, b.tokens.length, "Tokens size mismatch") &&
            eq(a.quantities.length, b.quantities.length, "Quantities size mismatch") &&
            eq(a.tokens.length, a.quantities.length, "invalid input");

        for (uint256 i = 0; ok && i < a.quantities.length; i++) {
            // TODO: Do fuzzy check
            ok = eq(a.quantities[i], b.quantities[i], "BU quantities mismatch");
            if (!ok) {
                console.log("Index: %s", i);
                return false;
            }
        }
    }

    /// @return Whether the oracle prices match or not
    function _eqOraclePrice(OraclePrice memory a, OraclePrice memory b) internal view returns (bool) {
        return eq(a.inETH, b.inETH, "OraclePrice.inETH") && eq(a.inUSD, b.inUSD, "OraclePrice.inUSD");
    }

    function _rawFix(Fix fix) internal returns (uint256) {
        return uint256(int256(Fix.unwrap(fix)));
    }
}
