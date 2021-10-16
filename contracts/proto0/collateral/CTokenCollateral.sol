// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./Collateral.sol";

// https://github.com/compound-finance/compound-protocol/blob/master/contracts/CToken.sol
interface ICToken {
    function exchangeRateCurrent() external returns (uint);
}


contract CTokenCollateral is Collateral {

    constructor(address erc20_, uint256 quantity_, uint8 decimals) Collateral(erc20_, quantity_, decimals) {}

    function getRedemptionRate() external override returns (uint256) {
        return ICToken(_erc20).exchangeRateCurrent();
    }
}
