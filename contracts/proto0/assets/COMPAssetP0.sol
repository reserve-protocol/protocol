// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "../interfaces/IMain.sol";
import "./AssetP0.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/proto0/libraries/Oracle.sol";

// Immutable data contract, extended to implement cToken and aToken wrappers.
contract COMPAssetP0 is AssetP0 {
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

    // @return {attoUSD/qCOMP}
    function priceUSD(IMain main) public override returns (Fix) {
        return main.consultOracle(Oracle.Source.COMPOUND, _erc20);
    }

    function fiatcoinPriceUSD(IMain) public view override returns (Fix) {
        assert(false);
        return FIX_ZERO;
    }

    function isFiatcoin() external pure override returns (bool) {
        return false;
    }
}
