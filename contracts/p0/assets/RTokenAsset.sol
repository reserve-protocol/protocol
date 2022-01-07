// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "contracts/p0/interfaces/IAsset.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/libraries/Fixed.sol";

contract RTokenAssetP0 is IAsset {
    using FixLib for Fix;

    UoA public immutable override uoa; // Unit of Account
    IERC20Metadata public immutable override erc20;
    IMain public immutable main;

    // TODO UoA may not make sense here, re-examine later
    constructor(
        UoA uoa_,
        IERC20Metadata erc20_,
        IMain main_
    ) {
        uoa = uoa_;
        erc20 = erc20_;
        main = main_;
    }

    /// @return p {Price/rTok}
    function price() public view override returns (Price memory p) {
        // {Price/BU}
        p = main.vault().basketPrice();

        // {attoUSD/rTok} = {attoUSD/BU} * {BU/rTok}
        p.attoUSD = p.attoUSD.mul(main.baseFactor());
        // {attoEUR/rTok} = {attoEUR/BU} * {BU/rTok}
        p.attoEUR = p.attoEUR.mul(main.baseFactor());
    }
}
