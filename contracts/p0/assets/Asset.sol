// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/p0/interfaces/IAsset.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/libraries/Oracle.sol";
import "contracts/libraries/Fixed.sol";

/// Abstract, immutable, base asset contract for specific token assets to extend
abstract contract AssetP0 is IAsset {
    using FixLib for Fix;
    using Oracle for Oracle.Info;

    address internal immutable _erc20;
    IMain internal immutable _main;
    Oracle.Source internal immutable _oracleSource;

    constructor(
        address erc20_,
        IMain main_,
        Oracle.Source oracleSource_
    ) {
        _erc20 = erc20_;
        _main = main_;
        _oracleSource = oracleSource_;
    }

    // solhint-disable-next-list no-empty-blocks
    function poke() public virtual override {}

    /// @return {attoUSD/qRSR}
    function priceUSD() public view virtual override returns (Fix) {
        return _main.oracle().consult(_oracleSource, _erc20);
    }

    /// @return The ERC20 contract of the central token
    function erc20() public view override returns (IERC20) {
        return IERC20(_erc20);
    }

    /// @return The number of decimals in the central token
    function decimals() public view override returns (uint8) {
        return IERC20Metadata(_erc20).decimals();
    }

    /// @return Whether `_erc20` is an AToken (StaticAToken, actually)
    function isAToken() public pure virtual override returns (bool) {
        return false;
    }

    function isCollateral() public pure virtual override returns (bool) {
        return false;
    }
}
