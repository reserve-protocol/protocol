// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "./ERC20Mock.sol";

contract CTokenMock is ERC20Mock {
    address internal immutable _underlyingAsset;

    uint256 internal _exchangeRate;

    constructor(
        string memory name,
        string memory symbol,
        address underlyingAsset
    ) ERC20Mock(name, symbol) {
        _underlyingAsset = underlyingAsset;
        _exchangeRate = 1e18;
    }

    function exchangeRateStored() external view returns (uint256) {
        return _exchangeRate;
    }

    function setExchangeRate(uint256 rate) external {
        _exchangeRate = rate;
    }

    function underlying() external view returns (address) {
        return _underlyingAsset;
    }
}
