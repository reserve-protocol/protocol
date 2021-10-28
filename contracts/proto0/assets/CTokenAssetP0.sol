// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "../interfaces/IMain.sol";
import "./AssetP0.sol";

// https://github.com/compound-finance/compound-protocol/blob/master/contracts/CToken.sol
interface ICToken {
    // function exchangeRateCurrent() external returns (uint256); // this one is a mutator

    function exchangeRateStored() external view returns (uint256);

    function underlying() external view returns (address);
}

contract CTokenAssetP0 is AssetP0 {
    // All cTokens have 8 decimals, but their underlying may have 18 or 6 or something else.
    constructor(address erc20_) AssetP0(erc20_) {}

    function redemptionRate() public view override returns (uint256) {
        return ICToken(_erc20).exchangeRateStored() * 10**(18 - fiatcoinDecimals());
    }

    function fiatcoin() public view override returns (address) {
        return ICToken(_erc20).underlying();
    }

    function priceUSD(IMain main) public view virtual override returns (uint256) {
        return (redemptionRate() * main.consultCompoundOracle(erc20())) / SCALE;
    }

    function fiatcoinPriceUSD(IMain main) public view virtual override returns (uint256) {
        return main.consultCompoundOracle(fiatcoin());
    }

    function isFiatcoin() external pure override returns (bool) {
        return false;
    }
}
