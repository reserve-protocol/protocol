// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "contracts/p0/interfaces/IAsset.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/p0/libraries/Oracle.sol";
import "./Asset.sol";

contract RTokenAssetP0 is AssetP0 {
    using FixLib for Fix;

    // TODO UoA may not make sense here, re-examine later
    constructor(IERC20Metadata erc20_, IMain main_)
        AssetP0(UoA.USD, erc20_, main_, Oracle.Source.AAVE)
    {}

    /// @return p {Price/rTok}
    function price() public view override returns (Price memory p) {
        // {Price/BU}
        p = main.vault().basketPrice();

        // {attoUSD/rTok} = {attoUSD/BU} * {BU/rTok}
        p.attoUSD = p.attoUSD.mul(main.baseFactor());
        // {attoEUR/rTok} = {attoEUR/BU} * {BU/rTok}
        p.attoEUR = p.attoEUR.mul(main.baseFactor());
    }

    /// @return If the asset is an instance of ICollateral or not
    function isCollateral() public view virtual override returns (bool) {
        return false;
    }
}
