// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "../../libraries/Fixed.sol";
import "./ERC20Mock.sol";

contract MCTokenMock is ERC20Mock {
    using FixLib for uint192;
    address internal _poolToken;

    uint256 internal _assets;

    constructor(
        string memory name,
        string memory symbol,
        address poolToken
    ) ERC20Mock(name, symbol) {
        _poolToken = poolToken;
        _assets = 1 ether;
    }

    function poolToken() external view returns (address) {
        return _poolToken;
    }

    function exchangeRateCurrent() external returns (uint256) {
        return _assets;
    }

    function convertToAssets(uint256 shares) external view returns (uint256 assets) {
        return _assets;
    }

    function decimals() public pure override returns (uint8) {
        return 18;
    }

    function setExchangeRate(uint256 newAssets) external {
        _assets = newAssets;
    }
}
