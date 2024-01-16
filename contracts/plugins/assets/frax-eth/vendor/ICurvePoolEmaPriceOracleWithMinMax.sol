// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.19;

interface ICurvePoolEmaPriceOracleWithMinMax {
    function CURVE_POOL_EMA_PRICE_ORACLE() external view returns (address);

    function CURVE_POOL_EMA_PRICE_ORACLE_PRECISION() external view returns (uint256);

    function getCurvePoolToken1EmaPrice() external view returns (uint256 _emaPrice);

    function maximumCurvePoolEma() external view returns (uint256);

    function minimumCurvePoolEma() external view returns (uint256);
}
