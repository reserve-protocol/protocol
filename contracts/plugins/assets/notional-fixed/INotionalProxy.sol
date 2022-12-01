// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.9;

interface INotionalProxy {
    /// @dev Market object as represented in memory
    struct MarketParameters {
        bytes32 storageSlot;
        uint256 maturity;
        // Total amount of fCash available for purchase in the market.
        int256 totalfCash;
        // Total amount of cash available for purchase in the market.
        int256 totalAssetCash;
        // Total amount of liquidity tokens (representing a claim on liquidity) in the market.
        int256 totalLiquidity;
        // This is the previous annualized interest rate in RATE_PRECISION that the market traded
        // at. This is used to calculate the rate anchor to smooth interest rates over time.
        uint256 lastImpliedRate;
        // Time lagged version of lastImpliedRate, used to value fCash assets at market rates while
        // remaining resistent to flash loan attacks.
        uint256 oracleRate;
        // This is the timestamp of the previous trade
        uint256 previousTradeTime;
    }

    /// @notice Returns all currently active markets for a currency
    function getActiveMarkets(uint16 currencyId) external view returns (MarketParameters[] memory);

    /// @notice Returns the amount of fCash that would received if lending deposit amount.
    /// @param currencyId id number of the currency
    /// @param depositAmountExternal amount to deposit in the token's native precision. For aTokens use
    /// what is returned by the balanceOf selector (not scaledBalanceOf).
    /// @param maturity the maturity of the fCash to lend
    /// @param minLendRate the minimum lending rate (slippage protection)
    /// @param blockTime the block time for when the trade will be calculated
    /// @param useUnderlying true if specifying the underlying token, false if specifying the asset token
    /// @return fCashAmount the amount of fCash that the lender will receive
    /// @return marketIndex the corresponding market index for the lending
    /// @return encodedTrade the encoded bytes32 object to pass to batch trade
    function getfCashLendFromDeposit(
        uint16 currencyId,
        uint256 depositAmountExternal,
        uint256 maturity,
        uint32 minLendRate,
        uint256 blockTime,
        bool useUnderlying
    ) external view returns (
        uint88 fCashAmount,
        uint8 marketIndex,
        bytes32 encodedTrade
    );

    /// @notice Returns the present value of the given fCash amount using Notional internal oracle rates
    /// @param currencyId id number of the currency
    /// @param maturity timestamp of the fCash maturity
    /// @param notional amount of fCash notional
    /// @param blockTime the block time for when the trade will be calculated
    /// @param riskAdjusted true if haircuts and buffers should be applied to the oracle rate
    /// @return presentValue of fCash in 8 decimal precision and underlying denomination
    function getPresentfCashValue(
        uint16 currencyId,
        uint256 maturity,
        int256 notional,
        uint256 blockTime,
        bool riskAdjusted
    ) external view returns (int256 presentValue);

    /** Initialize Markets Action */
    function initializeMarkets(uint16 currencyId, bool isFirstInit) external;
}

