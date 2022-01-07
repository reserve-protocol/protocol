// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/p0/assets/Asset.sol";
import "contracts/p0/interfaces/IAsset.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/interfaces/IRToken.sol";
import "contracts/p0/interfaces/IVault.sol";
import "contracts/p0/libraries/Oracle.sol";
import "contracts/libraries/Fixed.sol";

contract RTokenAssetP0 is AbstractAssetP0 {
    using FixLib for Fix;

    // TODO UoA may not make sense here, re-examine later
    // solhint-disable-next-list no-empty-blocks
    constructor(address erc20_, IMain main_)
        AbstractAssetP0(UoA.USD, erc20_, main_, Oracle.Source.AAVE)
    {}

    /// @return {Price/rTok}
    function price() public view override returns (Price memory p) {
        // {Price/BU}
        p = main.vault().basketPrice();

        // {attoUSD/rTok} = {attoUSD/BU} * {BU/rTok}
        p.attoUSD = p.attoUSD.mul(main.baseFactor());
        // {attoEUR/rTok} = {attoEUR/BU} * {BU/rTok}
        p.attoEUR = p.attoEUR.mul(main.baseFactor());
    }
}
