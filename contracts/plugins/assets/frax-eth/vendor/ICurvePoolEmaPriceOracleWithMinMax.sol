// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.19;

interface ICurvePoolEmaPriceOracleWithMinMax {
    // solhint-disable-next-line func-name-mixedcase
    function CURVE_POOL_EMA_PRICE_ORACLE() external view returns (address);

    // solhint-disable-next-line func-name-mixedcase
    function CURVE_POOL_EMA_PRICE_ORACLE_DECIMALS() external view returns (uint256);

    function getCurvePoolToken1EmaPrice() external view returns (uint256 _emaPrice);

    function maximumCurvePoolEma() external view returns (uint256);

    function minimumCurvePoolEma() external view returns (uint256);
}
