// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "./ERC20Mock.sol";

contract CTokenMock is ERC20Mock {
    address internal immutable _underlyingAsset;

    constructor(
        string memory name,
        string memory symbol,
        address underlyingAsset
    ) ERC20Mock(name, symbol) {
        _underlyingAsset = underlyingAsset;
    }

    function exchangeRateStored() external view returns (uint256) {
        return 1e18;
    }

    function underlying() external view returns (address) {
        return _underlyingAsset;
    }
}
