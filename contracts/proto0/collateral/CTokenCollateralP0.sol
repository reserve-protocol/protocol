// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./CollateralP0.sol";

// https://github.com/compound-finance/compound-protocol/blob/master/contracts/CToken.sol
interface ICToken {
    function exchangeRateCurrent() external view returns (uint256);

    function underlying() external view returns (address);
}

contract CTokenCollateralP0 is CollateralP0 {
    constructor(address erc20_, uint8 decimals) CollateralP0(erc20_, decimals) {}

    function redemptionRate() external view override returns (uint256) {
        return ICToken(_erc20).exchangeRateCurrent();
    }

    function fiatcoin() external view override returns (address) {
        return ICToken(_erc20).underlying();
    }

    function isFiatcoin() external pure override returns (bool) {
        return false;
    }
}
