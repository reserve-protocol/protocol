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

        /// From Compound Docs: The current exchange rate, scaled by 10^(18 - 8 + Underlying Token Decimals).
        Fix start = toFix(2, -2); // 0.02
        int8 leftShift = 18 - int8(decimals()) + int8(IERC20Metadata(underlyingAsset).decimals());
        _exchangeRate = start.mul(toFix(1, leftShift)).toUint();
    }

    function decimals() public view override returns (uint8) {
        return 8;
    }

    function exchangeRateStored() external view returns (uint256) {
        return _exchangeRate;
    }

    /// @dev Make sure to follow the same preparation method from lines 21-22
    function setExchangeRate(uint256 rate) external {
        _exchangeRate = rate;
    }

    function underlying() external view returns (address) {
        return _underlyingAsset;
    }
}
