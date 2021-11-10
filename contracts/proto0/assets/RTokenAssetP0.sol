// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/proto0/interfaces/IMain.sol";
import "contracts/proto0/interfaces/IVault.sol";
import "contracts/libraries/Fixed.sol";
import "./AssetP0.sol";

contract RTokenAssetP0 is AssetP0 {
    using FixLib for Fix;

    constructor(address erc20_) AssetP0(erc20_) {}

    function rateFiatcoin() public override returns (Fix) {
        assert(false);
        return FIX_ZERO;
    }

    function rateUSD() public override returns (Fix) {
        assert(false);
        return FIX_ZERO;
    }

    /// @return {attoUSD/qRTok}
    function priceUSD(IMain main) public override returns (Fix) {
        Fix sum; // {attoUSD/BU}
        IVault v = main.manager().vault();
        for (uint256 i = 0; i < v.size(); i++) {
            IAsset a = v.assetAt(i);

            // {attoUSD/BU} = {attoUSD/BU} + {qTok/BU} * {attoUSD/qTok}
            sum = sum.plus(a.priceUSD(main).mulu(v.quantity(a)));
        }

        // {attoUSD/qBU} = {attoUSD/BU} / {qBU/BU}
        Fix perQBU = sum.divu(10**v.BU_DECIMALS());

        // {attoUSD/qRTok} = {attoUSD/qBU} / {qRTok/qBU}
        return perQBU.mul(main.manager().baseFactor());
    }

    function fiatcoinPriceUSD(IMain) public view override returns (Fix) {
        assert(false);
        return FIX_ZERO;
    }

    function isFiatcoin() external pure override returns (bool) {
        return false;
    }
}
