// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/proto0/interfaces/IMain.sol";
import "contracts/proto0/interfaces/IVault.sol";
import "contracts/libraries/Fixed.sol";
import "./AssetP0.sol";

contract RTokenAssetP0 is AssetP0 {
    using FixLib for Fix;

    constructor(address erc20_) AssetP0(erc20_) {}

    function rateFiatcoin() public view override returns (Fix) {
        assert(false);
        return FIX_ZERO;
    }

    function rateUSD() public view override returns (Fix) {
        assert(false);
        return FIX_ZERO;
    }

    /// @return {USD/qRToken}
    function priceUSD(IMain main) public view override returns (Fix) {
        Fix sum; // {USD/BU}
        IVault v = main.manager().vault();
        for (uint256 i = 0; i < v.size(); i++) {
            IAsset a = v.assetAt(i);

            // {USD/BU} = {USD/BU} + {qTok/BU} * {USD/qTok}
            sum = sum.plus(v.quantity(a).mul(a.priceUSD(main)));
        }
        // fromBUs({USD/BU} * {qBU/BU})
        return toFix(main.manager().fromBUs(sum.mulu(10**v.BU_DECIMALS()).toUint()));
    }

    function fiatcoinPriceUSD(IMain) public view override returns (Fix) {
        assert(false);
        return FIX_ZERO;
    }

    function isFiatcoin() external pure override returns (bool) {
        return false;
    }
}
