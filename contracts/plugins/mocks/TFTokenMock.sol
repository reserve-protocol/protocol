// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "contracts/libraries/Fixed.sol";
import "./ERC20Mock.sol";

contract TFTokenMock is ERC20Mock {
    using FixLib for uint192;
    address internal _underlyingToken;
    uint256 public poolValue;

    constructor(
        string memory name,
        string memory symbol,
        address underlyingToken
    ) ERC20Mock(name, symbol) {
        _underlyingToken = underlyingToken;
        _mint(0x663FDeDb7Fa953DdB4FBf778D2c77DA497b7644a, FIX_ONE);
        poolValue = totalSupply(); // initial refpertok of 1
    }
    

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function setExchangeRate(uint192 rate) external {
        poolValue = rate * totalSupply() / FIX_ONE;
    }

    function underlying() external view returns (address) {
        return _underlyingToken;
    }
}