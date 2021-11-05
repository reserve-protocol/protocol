// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/libraries/Fixed.sol";
import "contracts/proto0/interfaces/IMain.sol";
import "./AssetP0.sol";

// Immutable data contract, extended to implement cToken and aToken wrappers.
contract RSRAssetP0 is AssetP0 {
    using FixLib for Fix;

    constructor(address erc20_) AssetP0(erc20_) {}

    function rateFiatcoin() public view override returns (Fix) {
        assert(false); // RSR does not have a redemption rate. Bad use of class.
        return FIX_ZERO;
    }

    function rateUSD() public view override returns (Fix) {
        assert(false); // RSR does not have a usd rate. Bad use of class.
        return FIX_ZERO;
    }

    /// @return {attoUSD/qRSR}
    function priceUSD(IMain main) public view override returns (Fix) {
        // {attoUSD/RSR} / {qRSR/RSR}
        return main.consultAaveOracle(_erc20).divu(10**decimals());
    }

    function fiatcoinPriceUSD(IMain) public view virtual override returns (Fix) {
        assert(false);
        return FIX_ZERO;
    }

    function isFiatcoin() external pure override returns (bool) {
        return false;
    }
}
