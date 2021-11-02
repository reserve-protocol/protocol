// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "../interfaces/IMain.sol";
import "./AssetP0.sol";
import "contracts/libraries/Fixed.sol";

// https://github.com/compound-finance/compound-protocol/blob/master/contracts/CToken.sol
interface ICToken {
    function exchangeRateCurrent() external returns (uint256);

    function exchangeRateStored() external view returns (uint256);

    function underlying() external view returns (address);
}

contract CTokenAssetP0 is AssetP0 {
    // All cTokens have 8 decimals, but their underlying may have 18 or 6 or something else.
    constructor(address erc20_) AssetP0(erc20_) {}

    function updateRedemptionRate() external virtual override {
        ICToken(_erc20).exchangeRateCurrent();
    }

    function redemptionRate() public view override returns (uint256) {
        return ICToken(_erc20).exchangeRateStored() * 10**(18 - fiatcoinDecimals());
    }

    function fiatcoin() public view override returns (address) {
        return ICToken(_erc20).underlying();
    }

    function priceUSD(IMain main) public view virtual override returns (Fix) {
        return toFix(redemptionRate() * main.consultCompoundOracle(address(erc20())));
    }

    function fiatcoinPriceUSD(IMain main) public view virtual override returns (uint256) {
        return main.consultCompoundOracle(fiatcoin());
    }

    function isFiatcoin() external pure override returns (bool) {
        return false;
    }
}
