// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/p0/interfaces/IAsset.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/interfaces/IRToken.sol";
import "contracts/p0/interfaces/IVault.sol";
import "contracts/p0/libraries/Oracle.sol";
import "contracts/libraries/Fixed.sol";

contract RTokenAssetP0 is IAsset {
    using FixLib for Fix;
    using Oracle for Oracle.Info;

    address internal immutable _erc20;

    constructor(address erc20_) {
        _erc20 = erc20_;
    }

    /// @return {attoUSD/qRTok}
    function priceUSD(Oracle.Info memory oracle) public view override returns (Fix) {
        Fix sum; // {attoUSD/BU}
        IMain main = IMain(IRToken(_erc20).main());
        IVault v = main.vault();
        for (uint256 i = 0; i < v.size(); i++) {
            ICollateral c = v.collateralAt(i);

            // {attoUSD/BU} = {attoUSD/BU} + {attoUSD/qTok} * {qTok/BU}
            sum = sum.plus(c.priceUSD(oracle).mulu(v.quantity(c)));
        }

        // {attoUSD/qBU} = {attoUSD/BU} / {qBU/BU}
        Fix perQBU = sum.divu(10**v.BU_DECIMALS());

        // {attoUSD/qRTok} = {attoUSD/qBU} * {qBU/qRTok}
        return perQBU.mul(main.baseFactor());
    }

    /// @return The ERC20 contract of the central token
    function erc20() public view virtual override returns (IERC20) {
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
}
