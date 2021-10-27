// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "../interfaces/ICollateral.sol";

// Immutable data contract, extended to implement cToken and aToken wrappers.
contract CollateralP0 is ICollateral {
    address internal immutable _erc20;

    constructor(address erc20_) {
        _erc20 = erc20_;
    }

    // Fiatcoins return 1e18. All redemption rates should have 18 zeroes.
    function redemptionRate() external view virtual override returns (uint256) {
        return 1e18;
    }

    function erc20() external view override returns (address) {
        return _erc20;
    }

    function decimals() external view override returns (uint8) {
        return IERC20Metadata(_erc20).decimals();
    }

    function fiatcoinDecimals() public view override returns (uint8) {
        return IERC20Metadata(fiatcoin()).decimals();
    }

    function fiatcoin() public view virtual override returns (address) {
        return _erc20;
    }

    function isFiatcoin() external pure virtual override returns (bool) {
        return true;
    }

    function oracle() external pure virtual override returns (string memory) {
        return "AAVE";
    }
}
