// SPDX-License-Identifier: ISC
pragma solidity ^0.8.19;

interface IEmaPriceOracleStableSwap {
    function price_oracle() external view returns (uint256);
}

/// @title CurvePoolEmaPriceOracleWithMinMax
/// @author Drake Evans (Frax Finance) https://github.com/drakeevans
/// @notice  An oracle for getting EMA prices from Curve
contract EmaPriceOracleStableSwapMock is IEmaPriceOracleStableSwap {
    uint256 public initPrice;
    uint256 internal _price;

    constructor(uint256 _initPrice) {
        initPrice = _initPrice;
        _price = _initPrice;
    }

    function resetPrice() external {
        _price = initPrice;
    }

    function setPrice(uint256 newPrice) external {
        _price = newPrice;
    }

    function price_oracle() external view returns (uint256) {
        return _price;
    }

    function decimals() external pure returns (uint8) {
        return 18;
    }
}
