// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "contracts/p0/interfaces/IAsset.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/interfaces/IOracle.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/p0/Asset.sol";

contract RTokenAssetP0 is AssetP0 {
    using FixLib for Fix;

    // solhint-disable no-empty-blocks
    constructor(
        IERC20Metadata erc20_,
        IMain main_,
        IOracle oracle_
    ) AssetP0(erc20_, main_, oracle_) {}

    /// @return {USD/rTok}
    function marketPrice() public view override returns (Fix) {
        // Until an RToken has been live for a while, it probably won't have an oracle

        // {rTok} = {qRTok} / {qRTok/rTok}
        Fix rTok = toFixWithShift(erc20.totalSupply(), -int8(erc20.decimals()));

        // {USD/rTok} = {USD} / {rTok}
        return main.projectedMcap().div(rTok);
    }
}
