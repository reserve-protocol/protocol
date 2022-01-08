// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "contracts/p0/interfaces/IAsset.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/libraries/Oracle.sol";
import "contracts/p0/libraries/Pricing.sol";
import "contracts/libraries/Fixed.sol";

/// Immutable base asset contract to be used directly for most assets
contract AssetP0 is IAsset {
    using FixLib for Fix;
    using Oracle for Oracle.Info;
    using PricingLib for Price;

    UoA public immutable override uoa; // Unit of Account
    IERC20Metadata public immutable override erc20;
    IMain public immutable main;
    Oracle.Source public immutable override oracleSource;

    constructor(
        UoA uoa_,
        IERC20Metadata erc20_,
        IMain main_,
        Oracle.Source oracleSource_
    ) {
        uoa = uoa_;
        erc20 = erc20_;
        main = main_;
        oracleSource = oracleSource_;
    }

    /// @return {attoUSD/tok}
    function price() public view virtual override returns (Price memory) {
        return main.oracle(uoa).consult(oracleSource, erc20);
    }

    /// @return p {attoUSD/qTok} Like `price()` but per token quanta
    function priceQ() public view virtual override returns (Price memory p) {
        p = price();
        p.setUSD(p.usd().shiftLeft(-int8(erc20.decimals())));
        p.setEUR(p.eur().shiftLeft(-int8(erc20.decimals())));
    }

    /// @return If the asset is an instance of ICollateral or not
    function isCollateral() public view virtual override returns (bool) {
        return false;
    }
}
