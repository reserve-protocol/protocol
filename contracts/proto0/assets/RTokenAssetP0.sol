// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "../interfaces/IMain.sol";
import "../interfaces/IVault.sol";
import "./AssetP0.sol";

// Immutable data contract, extended to implement cToken and aToken wrappers.
contract RTokenAssetP0 is AssetP0 {
    constructor(address erc20_) AssetP0(erc20_) {}

    // Fiatcoins return 1e18. All redemption rates should have 18 zeroes.
    function redemptionRate() public view override returns (uint256) {
        assert(false);
        return 0;
    }

    function priceUSD(IMain main) public view override returns (uint256 sum) {
        IVault v = main.manager().vault();
        for (uint256 i = 0; i < v.size(); i++) {
            IAsset a = v.assetAt(i);
            sum += (v.quantity(a) * a.priceUSD(main)) / 10**a.decimals();
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
