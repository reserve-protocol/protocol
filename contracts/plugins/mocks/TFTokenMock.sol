// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "../../libraries/Fixed.sol";
import "./ERC20Mock.sol";

contract TFTTokenMock is ERC20Mock {
    using FixLib for uint192;
    address internal _underlyingToken;
    uint256 public poolValue;

    constructor(
        string memory name,
        string memory symbol,
        address underlyingToken
    ) ERC20Mock(name, symbol) {
        _underlyingToken = underlyingToken;
        poolValue = totalSupply();
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function setExchangeRate(uint192 rate) external {
        uint192 fixPoolValue = rate.mul(shiftl_toFix(totalSupply(), -6));
        poolValue = shiftl_toFix(fixPoolValue, -(36 - 6));
    }

    function underlying() external view returns (address) {
        return _underlyingToken;
    }
}