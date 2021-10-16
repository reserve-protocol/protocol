// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../interfaces/ICollateral.sol";

contract Collateral is ICollateral {
    using SafeERC20 for IERC20;

    address internal immutable _erc20;
    uint256 internal immutable _quantity;
    uint8 internal immutable _decimals;

    constructor(address erc20_, uint256 quantity_, uint8 decimals_) {
        _erc20 = erc20_;
        _quantity = quantity_;
        _decimals = decimals_;
    }

    // Fiatcoins return 1e18. Lending tokens may have redemption rates > 1e18. 
    function getRedemptionRate() external virtual override returns (uint256) {
        return 1e18;
    }

    function quantity() external view override returns (uint256) {
        return _quantity;
    }

    function erc20() external view override returns (address) {
        return _erc20;
    }

    function decimals() external view override returns (uint8) {
        return _decimals;
    }
}
