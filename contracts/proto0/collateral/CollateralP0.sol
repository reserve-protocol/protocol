// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../interfaces/ICollateral.sol";

// Immutable data contract, extended to implement cToken and aToken wrappers.
contract CollateralP0 is ICollateral {
    using SafeERC20 for IERC20;

    address internal immutable _erc20;
    uint8 internal immutable _decimals;

    constructor(address erc20_, uint8 decimals_) {
        _erc20 = erc20_;
        _decimals = decimals_;
    }

    // Fiatcoins return 1e18. Lending tokens may have redemption rates > 1e18.
    function redemptionRate() external view virtual override returns (uint256) {
        return 1e18;
    }

    function erc20() external view override returns (address) {
        return _erc20;
    }

    function decimals() external view override returns (uint8) {
        return _decimals;
    }

    function fiatcoin() external view virtual override returns (address) {
        return _erc20;
    }

    function isFiatcoin() external pure virtual override returns (bool) {
        return true;
    }
}
