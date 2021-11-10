// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
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

    uint256 internal _exchangeRate;

    constructor(
        string memory name,
        string memory symbol,
        address underlyingAsset
    ) ERC20Mock(name, symbol) {
        aToken = new ATokenMock(name, symbol, underlyingAsset);

        // In Aave all rates are in {RAYs/tok}, and they are independent of the underlying's decimals
        _exchangeRate = 1e27;
    }

    function decimals() public view override returns (uint8) {
        return 18;
    }

    function rate() external view returns (uint256) {
        return _exchangeRate;
    }

    function setExchangeRate(uint256 rate) external {
        _exchangeRate = rate;
    }

    function ATOKEN() external view returns (ATokenMock) {
        return aToken;
    }
}
