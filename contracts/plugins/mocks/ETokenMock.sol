// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "../../libraries/Fixed.sol";
import "./ERC20Mock.sol";

contract ETokenMock is ERC20Mock {
    using FixLib for uint192;
    address internal _underlyingToken;
    uint256 internal _exchangeRate;

    constructor(
        string memory name,
        string memory symbol,
        address underlyingToken
    ) ERC20Mock(name, symbol) {
        _underlyingToken = underlyingToken;
        _exchangeRate = _toExchangeRate(FIX_ONE);
    }

    function decimals() public pure override returns (uint8) {
        return 18;
    }

    function convertBalanceToUnderlying(uint balance) external view returns (uint) {
      uint8 d = IERC20Metadata(_underlyingToken).decimals();
      int8 leftShift = int8(d) - int8(decimals());
      return (uint192(balance).shiftl(leftShift) * _exchangeRate)/(1*10**(d));
    }

    /// @param fiatcoinRedemptionRate {fiatTok/tok}
    function setExchangeRate(uint192 fiatcoinRedemptionRate) external {
        _exchangeRate = _toExchangeRate(fiatcoinRedemptionRate);
    }

    function underlying() external view returns (address) {
        return _underlyingToken;
    }

    function _toExchangeRate(uint192 fiatcoinRedemptionRate) internal view returns (uint256) {
        /// From Compound Docs: The current exchange rate, scaled by 10^(18 - 8 + Underlying Token Decimals).
        int8 leftShift = int8(IERC20Metadata(_underlyingToken).decimals()) - int8(decimals());
        return fiatcoinRedemptionRate.shiftl(leftShift);
    }

    // function selector for testing
    function touch() external {
    }
}
