// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "./ERC20Mock.sol";

// This is the inner, rebasing ERC. It's not what we interact with.
contract ATokenMock is ERC20Mock {
    address internal immutable _underlyingAsset;

    constructor(
        string memory name,
        string memory symbol,
        address underlyingAsset
    ) ERC20Mock(name, symbol) {
        _underlyingAsset = underlyingAsset;
    }

    function UNDERLYING_ASSET_ADDRESS() external view returns (address) {
        return _underlyingAsset;
    }
}

// This is the non-rebasing wrapper, which is what we care about.
contract StaticATokenMock is ERC20Mock {
    ATokenMock internal immutable aToken;

    constructor(
        string memory name,
        string memory symbol,
        address underlyingAsset
    ) ERC20Mock(name, symbol) {
        aToken = new ATokenMock(name, symbol, underlyingAsset);
    }

    function rate() external view returns (uint256) {
        return 1e18;
    }

    function ATOKEN() external view returns (ATokenMock) {
        return aToken;
    }
}
