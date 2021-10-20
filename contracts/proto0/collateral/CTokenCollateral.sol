// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./Collateral.sol";

// https://github.com/compound-finance/compound-protocol/blob/master/contracts/CToken.sol
interface ICToken {
    function exchangeRateCurrent() external view returns (uint256);

    function underlying() external view returns (address);
}

contract CTokenCollateral is Collateral {
    constructor(
        address erc20_,
        uint256 quantity_,
        uint8 decimals
    ) Collateral(erc20_, quantity_, decimals) {}

    function getRedemptionRate() external view override returns (uint256) {
        return ICToken(_erc20).exchangeRateCurrent();
    }

    function getUnderlyingERC20() external view override returns (address) {
        return ICToken(_erc20).underlying();
    }

    function isFiatcoin() external pure override returns (bool) {
        return false;
    }
}
