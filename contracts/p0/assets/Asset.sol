// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "contracts/p0/interfaces/IAsset.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/libraries/Oracle.sol";
import "contracts/libraries/Fixed.sol";

/// Abstract, immutable, base asset contract for all other assets and collateral to extend
abstract contract AssetP0 is IAsset {
    UoA public immutable override uoa; // Unit of Account
    IERC20Metadata public immutable override erc20;
    IMain public immutable main;

    constructor(
        UoA uoa_,
        IERC20Metadata erc20_,
        IMain main_
    ) {
        uoa = uoa_;
        erc20 = erc20_;
        main = main_;
    }
}

/// Immutable base asset contract to be used directly for most assets
contract USDAssetP0 is AssetP0 {
    using FixLib for Fix;
    using Oracle for Oracle.Info;

    Oracle.Source public immutable oracleSource;

    constructor(
        UoA uoa_,
        IERC20Metadata erc20_,
        IMain main_,
        Oracle.Source oracleSource_
    ) AssetP0(uoa_, erc20_, main_) {
        oracleSource = oracleSource_;
    }

    /// @return {attoUSD/tok}
    function price() public view virtual override returns (Price memory) {
        return main.oracle(uoa).consult(oracleSource, erc20);
    }
}
