// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/p0/interfaces/IAsset.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/libraries/Oracle.sol";
import "contracts/libraries/Fixed.sol";

import "hardhat/console.sol";

/**
 * @title CollateralP0
 * @notice A vanilla asset such as a fiatcoin, to be extended by more complex assets such as cTokens.
 */
contract CollateralP0 is ICollateral {
    using FixLib for Fix;
    using Oracle for Oracle.Info;

    address internal immutable _erc20;

    constructor(address erc20_) {
        _erc20 = erc20_;
    }

    /// Forces an update in any underlying Defi protocol
    /// @return Whether the collateral meets its invariants or not
    function poke() external virtual override returns (bool) {
        return true;
    }

    /// @return {qFiatTok/qTok} Conversion rate between token and its fiatcoin. Incomparable across assets.
    function rateFiatcoin() public view virtual override returns (Fix) {
        // {qFiatTok/qTok} = {qFiatTok/fiatTok} / {qTok/tok}
        return toFixWithShift(1, int8(fiatcoinDecimals()) - int8(decimals()));
    }

    /// @return {attoUSD/qTok} Without using oracles, returns the expected attoUSD value of one qTok.
    function rateUSD() public view virtual override returns (Fix) {
        // {attoUSD/qTok} = {attoUSD/tok} / {qTok/tok}
        return toFixWithShift(1, 18 - int8(decimals()));
    }

    /// @return {attoUSD/qTok} The price in attoUSD of the asset's smallest unit
    function priceUSD(Oracle.Info memory oracle) public view virtual override returns (Fix) {
        if (isFiatcoin()) {
            return oracle.consult(Oracle.Source.AAVE, _erc20);
        } else {
            // {attoUSD/qTok} = {attoUSD/qFiatTok} * {qFiatTok/qTok}
            return fiatcoinPriceUSD(oracle).mul(rateFiatcoin());
        }
    }

    /// @return The ERC20 contract of the central token
    function erc20() public view virtual override returns (IERC20) {
        return IERC20(_erc20);
    }

    /// @return The number of decimals in the central token
    function decimals() public view override returns (uint8) {
        return IERC20Metadata(_erc20).decimals();
    }

    /// @return The number of decimals in the nested fiatcoin contract (or for the erc20 itself if it is a fiatcoin)
    function fiatcoinDecimals() public view override returns (uint8) {
        return IERC20Metadata(address(fiatcoin())).decimals();
    }

    /// @return The fiatcoin underlying the ERC20, or the erc20 itself if it is a fiatcoin
    function fiatcoin() public view virtual override returns (IERC20) {
        return IERC20(_erc20);
    }

    /// @return {attoUSD/qFiatTok} The price in attoUSD of the fiatcoin's smallest unit
    function fiatcoinPriceUSD(Oracle.Info memory oracle)
        public
        view
        virtual
        override
        returns (Fix)
    {
        return oracle.consult(Oracle.Source.AAVE, address(fiatcoin()));
    }

    /// @return Whether `_erc20` is a fiatcoin
    function isFiatcoin() public pure virtual override returns (bool) {
        return true;
    }

    /// @return Whether `_erc20` is an AToken (StaticAToken, actually)
    function isAToken() public pure virtual override returns (bool) {
        return false;
    }
}
