// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/p0/assets/Asset.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/interfaces/IRToken.sol";
import "contracts/p0/interfaces/IVault.sol";
import "contracts/p0/libraries/Oracle.sol";
import "contracts/libraries/Fixed.sol";


contract RTokenAssetP0 is AssetP0 {
    using FixLib for Fix;

    // oracleSource will be ignored.
    // solhint-disable-next-list no-empty-blocks
    constructor(address erc20_, IMain main_) AssetP0(erc20_, main_, Oracle.Source.AAVE) {}

    /// @return {attoUSD/qRTok}
    function priceUSD() public view override returns (Fix) {
        Fix sum; // {attoUSD/BU}
        IMain main = IMain(IRToken(_erc20).main());
        IVault v = main.vault();
        for (uint256 i = 0; i < v.size(); i++) {
            ICollateral c = v.collateralAt(i);

            // {attoUSD/BU} = {attoUSD/BU} + {attoUSD/qTok} * {qTok/BU}
            sum = sum.plus(c.priceUSD().mulu(v.quantity(c)));
        }

        // {attoUSD/qBU} = {attoUSD/BU} / {qBU/BU}
        uint256 perQBU = sum.divu(10**v.BU_DECIMALS()).floor();

        // {attoUSD/qRTok} = {attoUSD/qBU} * {qBU/qRTok}
        return toFix(main.fromBUs(perQBU));
    }
}
