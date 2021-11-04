// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/proto0/interfaces/IMain.sol";
import "contracts/proto0/assets/AssetP0.sol";
import "contracts/libraries/Fixed.sol";

// https://github.com/compound-finance/compound-protocol/blob/master/contracts/CToken.sol
interface ICToken {
    /// @return {qTok/lotCToken}
    function exchangeRateCurrent() external returns (uint256);

    /// @return {qTok/lotCToken}
    function exchangeRateStored() external view returns (uint256);

    function underlying() external view returns (address);
}

contract CTokenAssetP0 is AssetP0 {
    using FixLib for Fix;

    // All cTokens have 8 decimals, but their underlying may have 18 or 6 or something else.
    constructor(address erc20_) AssetP0(erc20_) {}

    function updateRates() external virtual override {
        ICToken(_erc20).exchangeRateCurrent();
    }

    /// @return {qFiatTok/qTok}
    function rateFiatcoin() public view override returns (Fix) {
        // {qFiatTok/tok} / {qTok/tok}
        return toFix(ICToken(_erc20).exchangeRateStored()).divu(10**decimals());
    }

    function fiatcoin() public view override returns (address) {
        return ICToken(_erc20).underlying();
    }

    /// @return {USD/fiatTok}
    function fiatcoinPriceUSD(IMain main) public view virtual override returns (Fix) {
        return main.consultCompoundOracle(fiatcoin()); // {USD/fiatTok}
    }

    function isFiatcoin() external pure override returns (bool) {
        return false;
    }
}
