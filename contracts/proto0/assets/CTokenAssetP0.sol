// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/proto0/interfaces/IMain.sol";
import "contracts/proto0/assets/AssetP0.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/proto0/libraries/Oracle.sol";

// cToken initial exchange rate is 0.02

// https://github.com/compound-finance/compound-protocol/blob/master/contracts/CToken.sol
interface ICToken {
    /// @dev From Compound Docs: The current exchange rate, scaled by 10^(18 - 8 + Underlying Token Decimals).
    function exchangeRateCurrent() external returns (uint256);

    /// @dev From Compound Docs: The current exchange rate, scaled by 10^(18 - 8 + Underlying Token Decimals).
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
        Fix rate = _exchangeRateRelativeToGenesis(); // {fiatTok/tok}
        // {qFiatTok/qTok} = {fiatTok/tok} * {qFiatTok/fiatTok} / {qTok/tok}

        int8 shiftLeft = int8(fiatcoinDecimals()) - int8(decimals());
        return rate.mul(toFix(1, shiftLeft));
    }

    /// @return {attoUSD/qTok} Without using oracles, returns the expected USD value of one whole tok.
    function rateUSD() public view virtual override returns (Fix) {
        Fix rate = _exchangeRateRelativeToGenesis(); // {fiatTok/tok}

        // {attoUSD/qTok} = {fiatTok/tok} * {attoUSD/fiatTok} / {qTok/tok}

        int8 shiftLeft = 18 - int8(decimals());
        return rate.mul(toFix(1, shiftLeft));
    }

    function fiatcoin() public view override returns (address) {
        return ICToken(_erc20).underlying();
    }

    /// @return {attoUSD/qFiatTok}
    function fiatcoinPriceUSD(IMain main) public view virtual override returns (Fix) {
        return main.consultOracle(Oracle.Source.COMPOUND, fiatcoin());
    }

    function isFiatcoin() external pure override returns (bool) {
        return false;
    }

    /// @return {fiatTok/tok}
    function _exchangeRateRelativeToGenesis() internal view returns (Fix) {
        Fix genesis = toFix(2, -2); // 0.02, their hardcoded starting rate
        uint256 r = ICToken(_erc20).exchangeRateStored();
        int8 shiftLeft = int8(decimals()) - int8(fiatcoinDecimals()) - 18;
        Fix rateNow = toFix(r, shiftLeft);
        return rateNow.div(genesis);
    }
}
