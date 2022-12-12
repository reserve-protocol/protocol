// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "../../libraries/Fixed.sol";
import "./ERC20Mock.sol";

contract TrueFiPoolMock is ERC20Mock {
    using FixLib for uint192;
    address internal _underlyingToken;

    uint256 internal _poolValue;
    uint256 internal _deficitValue;
    uint8 internal _decimals;

    constructor(
        string memory name,
        string memory symbol,
        address underlyingToken,
        uint8 decimal
    ) ERC20Mock(name, symbol) {
        _underlyingToken = underlyingToken;
        _decimals = decimal;
        _poolValue = _withDecimals(FIX_ZERO);
        _deficitValue = _withDecimals(FIX_ZERO);
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function poolValue() external view returns (uint256) {
        return _poolValue;
    }

    function deficitValue() external view returns (uint256) {
        return _deficitValue;
    }

    function setPoolValue(uint192 value) external {
        _poolValue = _withDecimals(value);
    }

    function setDeficitValue(uint192 value) external {
        _deficitValue = _withDecimals(value);
    }

    function underlying() external view returns (address) {
        return _underlyingToken;
    }

    function _withDecimals(uint192 value) internal view returns (uint256) {
        /// From Compound Docs: The current exchange rate, scaled by 10^(18 - 8 + Underlying Token Decimals).
        int8 leftShift = int8(decimals()) - 18;
        return value.shiftl(leftShift);
    }
}
