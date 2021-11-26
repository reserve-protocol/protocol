// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "contracts/libraries/Fixed.sol";
import "./ERC20Mock.sol";

contract CTokenMock is ERC20Mock {
    using FixLib for Fix;
    address internal immutable _underlyingAsset;

    uint256 internal _exchangeRate;

    constructor(
        string memory name,
        string memory symbol,
        address underlyingAsset
    ) ERC20Mock(name, symbol) {
        _underlyingAsset = underlyingAsset;
        _exchangeRate = _toExchangeRate(FIX_ONE);
    }

    function decimals() public pure override returns (uint8) {
        return 8;
    }

    function exchangeRateCurrent() external view returns (uint256) {
        return _exchangeRate;
    }

    /// @param fiatcoinRedemptionRate {fiatTok/tok}
    function setExchangeRate(Fix fiatcoinRedemptionRate) external {
        _exchangeRate = _toExchangeRate(fiatcoinRedemptionRate);
    }

    function underlying() external view returns (address) {
        return _underlyingAsset;
    }

    function _toExchangeRate(Fix fiatcoinRedemptionRate) internal view returns (uint256) {
        /// From Compound Docs: The current exchange rate, scaled by 10^(18 - 8 + Underlying Token Decimals).
        Fix start = toFixWithShift(2, -2); // 0.02
        int8 leftShift = 18 - int8(decimals()) + int8(IERC20Metadata(_underlyingAsset).decimals());
        return fiatcoinRedemptionRate.shiftLeft(leftShift).mul(start).toUint();
    }
}
