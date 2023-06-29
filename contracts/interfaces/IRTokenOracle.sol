// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

// RToken Oracle Interface
interface IRTokenOracle {
    struct CachedOracleData {
        uint192 cachedPrice; // {UoA/tok}
        uint256 cachedAtTime; // {s}
        uint48 cachedAtNonce; // {basketNonce}
        uint48 cachedTradesOpen;
        uint256 cachedTradesNonce; // {tradeNonce}
    }

    // @returns rTokenPrice {D18} {UoA/rTok} The price of the RToken, in UoA
    function latestPrice() external returns (uint192 rTokenPrice, uint256 updatedAt);

    // Force recalculate the price of the RToken
    function forceUpdatePrice() external;
}
