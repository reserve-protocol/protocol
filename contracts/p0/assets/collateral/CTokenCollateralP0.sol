// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/assets/collateral/CollateralP0.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/p0/libraries/Oracle.sol";

// cToken initial exchange rate is 0.02

// https://github.com/compound-finance/compound-protocol/blob/master/contracts/CToken.sol
interface ICToken {
    /// @dev From Compound Docs: The current exchange rate, scaled by 10^(18 - 8 + Underlying Token Decimals).
    function exchangeRateCurrent() external returns (uint256);

    function underlying() external view returns (address);
}

contract CTokenCollateralP0 is CollateralP0 {
    using FixLib for Fix;

    Fix public immutable initialExchangeRate; // 0.02, their hardcoded starting rate

    // All cTokens have 8 decimals, but their underlying may have 18 or 6 or something else.
    // solhint-disable-next-line no-empty-blocks
    constructor(address erc20_) CollateralP0(erc20_) {
        initialExchangeRate = toFixWithShift(2, -2);
    }

    /// @return {qFiatTok/qTok}
    function rateFiatcoin() public view override returns (Fix) {
        Fix rate = _exchangeRateRelativeToGenesis(); // {fiatTok/tok}
        // {qFiatTok/qTok} = {fiatTok/tok} * {qFiatTok/fiatTok} / {qTok/tok}

        int8 shiftLeft = int8(fiatcoinDecimals()) - int8(decimals());
        return rate.shiftLeft(shiftLeft);
    }

    /// @return {attoUSD/qTok} Without using oracles, returns the expected USD value of one qTok.
    function rateUSD() public view override returns (Fix) {
        Fix rate = _exchangeRateRelativeToGenesis(); // {fiatTok/tok}

        // {attoUSD/qTok} = {fiatTok/tok} * {attoUSD/fiatTok} / {qTok/tok}
        int8 shiftLeft = 18 - int8(decimals());
        return rate.shiftLeft(shiftLeft);
    }

    function fiatcoin() public view override returns (IERC20) {
        return IERC20(ICToken(_erc20).underlying());
    }

    /// @return {attoUSD/qFiatTok}
    function fiatcoinPriceUSD(IMain main) public view override returns (Fix) {
        return main.consultOracle(Oracle.Source.AAVE, address(fiatcoin()));
    }

    function isFiatcoin() public pure override returns (bool) {
        return false;
    }

    /// @return {fiatTok/tok}
    function _exchangeRateRelativeToGenesis() internal view returns (Fix) {
        bytes memory result = Address.functionStaticCall(_erc20, abi.encodeWithSignature("exchangeRateCurrent()"));
        int8 shiftLeft = int8(decimals()) - int8(fiatcoinDecimals()) - 18;
        Fix rateNow = toFixWithShift(abi.decode(result, (uint256)), shiftLeft);
        return rateNow.div(initialExchangeRate);
    }
}
