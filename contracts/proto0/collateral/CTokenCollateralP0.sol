// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./CollateralP0.sol";

// https://github.com/compound-finance/compound-protocol/blob/master/contracts/CToken.sol
interface ICToken {
    function exchangeRateStored() external view returns (uint256);

    function underlying() external view returns (address);
}

contract CTokenCollateralP0 is CollateralP0 {
    // All cTokens have 8 decimals, but their underlying may have 18 or 6 or something else.
    constructor(address erc20_) CollateralP0(erc20_) {}

    function redemptionRate() external view override returns (uint256) {
        return ICToken(_erc20).exchangeRateStored() * 10**(18 - fiatcoinDecimals());
    }

    function fiatcoin() public view override returns (address) {
        return ICToken(_erc20).underlying();
    }

    function isFiatcoin() external pure override returns (bool) {
        return false;
    }

    function oracle() external pure virtual override returns (string memory) {
        return "COMP";
    }
}
