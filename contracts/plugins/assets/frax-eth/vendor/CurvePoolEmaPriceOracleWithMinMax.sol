// SPDX-License-Identifier: ISC
pragma solidity ^0.8.19;

// Inspired by Frax Finance: https://github.com/FraxFinance

// Original Author
// Drake Evans: https://github.com/DrakeEvans

// Original Reviewers
// Dennis: https://github.com/denett

// ====================================================================

import { ICurvePoolEmaPriceOracleWithMinMax } from "./ICurvePoolEmaPriceOracleWithMinMax.sol";

interface IEmaPriceOracleStableSwap {
    function price_oracle() external view returns (uint256);
}

struct ConstructorParams {
    address curvePoolEmaPriceOracleAddress;
    uint256 minimumCurvePoolEma;
    uint256 maximumCurvePoolEma;
}

/// @title CurvePoolEmaPriceOracleWithMinMax
/// @author Drake Evans (Frax Finance) https://github.com/drakeevans
/// @notice  An oracle for getting EMA prices from Curve
contract CurvePoolEmaPriceOracleWithMinMax is ICurvePoolEmaPriceOracleWithMinMax {
    /// @notice Curve pool, source of EMA
    address public immutable CURVE_POOL_EMA_PRICE_ORACLE;

    /// @notice Precision of Curve pool price_oracle()
    uint256 public constant CURVE_POOL_EMA_PRICE_ORACLE_DECIMALS = 18;

    /// @notice Maximum price of token1 in token0 units of the EMA
    /// @dev Must match precision of EMA
    uint256 public minimumCurvePoolEma;

    /// @notice Maximum price of token1 in token0 units of the EMA
    /// @dev Must match precision of EMA
    uint256 public maximumCurvePoolEma;

    constructor(
        address curvePoolEmaPriceOracleAddress,
        uint256 _minimumCurvePoolEma,
        uint256 _maximumCurvePoolEma
    ) {
        CURVE_POOL_EMA_PRICE_ORACLE = curvePoolEmaPriceOracleAddress;
        minimumCurvePoolEma = _minimumCurvePoolEma;
        maximumCurvePoolEma = _maximumCurvePoolEma;
    }

    function _getCurvePoolToken1EmaPrice() internal view returns (uint256 _token1Price) {
        uint256 _priceRaw = IEmaPriceOracleStableSwap(CURVE_POOL_EMA_PRICE_ORACLE).price_oracle();
        uint256 _price = _priceRaw > maximumCurvePoolEma ? maximumCurvePoolEma : _priceRaw;

        _token1Price = _price < minimumCurvePoolEma ? minimumCurvePoolEma : _price;
    }

    /// @notice The ```getCurvePoolToken1EmaPrice``` function gets the price of the second token in the Curve pool (token1)
    /// @dev Returned in units of the first token (token0)
    /// @return _emaPrice The price of the second token in the Curve pool
    function getCurvePoolToken1EmaPrice() external view returns (uint256 _emaPrice) {
        return _getCurvePoolToken1EmaPrice();
    }
}