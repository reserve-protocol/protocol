// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "../../../libraries/Fixed.sol";
import "../ERC20Mock.sol";

contract TfTokenMock is ERC20Mock {
    using FixLib for uint192;
    address internal _underlyingToken;

    uint256 internal _exchangeRate;
    uint256 internal _poolValue;
    uint256 internal _totalSupply;

    constructor(
        string memory name,
        string memory symbol,
        address underlyingToken
    ) ERC20Mock(name, symbol) {
        _underlyingToken = underlyingToken;
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function poolValue() public view returns (uint256) {
        return _poolValue;
    }

    function totalSupply() public view override returns (uint256) {
        return _totalSupply;
    }

    function setPoolValue(uint256 newPoolValue) external {
        _poolValue = newPoolValue;
    }

    function setTotalSupply(uint256 newTotalSupply) external {
        _totalSupply = newTotalSupply;
    }

    function underlying() external view returns (address) {
        return _underlyingToken;
    }
}
