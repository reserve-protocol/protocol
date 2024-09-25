// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "../../libraries/Fixed.sol";
import "../assets/compoundv2/ICToken.sol";
import "./ERC20Mock.sol";

contract CTokenMock is ERC20Mock {
    using FixLib for uint192;
    address internal _underlyingToken;

    uint256 internal _exchangeRate;

    bool public revertExchangeRateCurrent;
    bool public revertExchangeRateStored;

    IComptroller public immutable comptroller;

    constructor(
        string memory name,
        string memory symbol,
        address underlyingToken,
        IComptroller _comptroller
    ) ERC20Mock(name, symbol) {
        _underlyingToken = underlyingToken;
        _exchangeRate = _toExchangeRate(FIX_ONE);
        comptroller = _comptroller;
    }

    function decimals() public pure override returns (uint8) {
        return 8;
    }

    function exchangeRateCurrent() external returns (uint256) {
        if (revertExchangeRateCurrent) {
            revert("reverting exchange rate current");
        }
        _exchangeRate = _exchangeRate; // just to avoid sol warning
        return _exchangeRate;
    }

    function exchangeRateStored() external view returns (uint256) {
        if (revertExchangeRateStored) {
            revert("reverting exchange rate stored");
        }
        return _exchangeRate;
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
        uint192 start = shiftl_toFix(2, -2); // 0.02
        int8 leftShift = 18 - int8(decimals()) + int8(IERC20Metadata(_underlyingToken).decimals());
        return fiatcoinRedemptionRate.shiftl(leftShift).mul_toUint(start);
    }

    function setRevertExchangeRateCurrent(bool newVal) external {
        revertExchangeRateCurrent = newVal;
    }

    function setRevertExchangeRateStored(bool newVal) external {
        revertExchangeRateStored = newVal;
    }
}
