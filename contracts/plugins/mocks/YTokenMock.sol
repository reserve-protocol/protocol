// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "contracts/libraries/Fixed.sol";
import "./ERC20Mock.sol";

contract VaultTokenMock is ERC20Mock {
    uint256 internal _exchangeRate;
    IERC20Metadata public immutable token;
    uint8 public immutable _decimals;

    constructor(
        string memory name,
        string memory symbol,
        IERC20Metadata underlyingToken
    ) ERC20Mock(name, symbol) {
        token = underlyingToken;
        _exchangeRate = FIX_ONE;
        _decimals = underlyingToken.decimals();
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function pricePerShare() external view returns (uint256) {
        return _exchangeRate;
    }

    function setExchangeRate(uint192 newExchangeRate) external {
        _exchangeRate = FixLib.shiftl(newExchangeRate, -int8(FIX_DECIMALS) + int8(_decimals));
    }
}
