// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "../libraries/Oracle.sol";
import "./AssetP0.sol";

// Immutable data contract, extended to implement cToken and aToken wrappers.
contract COMPAssetP0 is AssetP0 {

    constructor(address erc20_, Oracle.Info memory oracle) AssetP0(erc20_, oracle_) {}

    // Fiatcoins return 1e18. All redemption rates should have 18 zeroes.
    function redemptionRate() external view override returns (uint256) {
        assert(false);
        return 0;
    }

    function priceUSD() public view virtual override returns (uint256) {
        return redemptionRate() * _oracle.consultCompound(erc20()) / SCALE;
    }

    function fiatcoinPriceUSD() public view virtual override returns (uint256) {
        assert(false);
        return 0;
    }

    function isFiatcoin() external pure override returns (bool) {
        return false;
    }
}
