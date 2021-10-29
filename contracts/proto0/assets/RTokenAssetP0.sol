// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "../interfaces/IMain.sol";
import "../interfaces/IVault.sol";
import "./AssetP0.sol";
import "contracts/libraries/Fixed.sol";

// Immutable data contract, extended to implement cToken and aToken wrappers.
contract RTokenAssetP0 is AssetP0 {
    constructor(address erc20_) AssetP0(erc20_) {}

    // Fiatcoins return 1e18. All redemption rates should have 18 zeroes.
    function redemptionRate() public view override returns (uint256) {
        assert(false);
        return 0;
    }

    // Return the price of one lot of this token in USD.
    // (Here, 1 lot *is* 1 RToken, because RToken has 18 decimals.)
    function priceUSD(IMain main) public view override returns (Fix sum) {
        IVault v = main.manager().vault();
        for (uint256 i = 0; i < v.size(); i++) {
            Fix asset_quantity = v.quantity(v.assetAt(i));
            sum = sum.plus( asset_quantity.times(a.priceUSD(main)) );
        }
    }

    function fiatcoinPriceUSD(IMain) public view override returns (uint256) {
        assert(false);
        return 0;
    }

    function isFiatcoin() external pure override returns (bool) {
        return false;
    }
}
