// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "../libraries/LibDiamond.sol";
import "../interfaces/IERC173.sol";

contract OwnershipFacet is IERC173 {
    AppStorage internal s;

    function transferOwnership(address _newOwner) external override {
        LibDiamond.enforceIsContractOwner();
        LibDiamond.setContractOwner(_newOwner);
    }

    function owner() external override view returns (address owner_) {
        owner_ = LibDiamond.contractOwner();
    }

    /// Quantities collateral token necessary to have 1e18 RToken in value
    function updatePrices(
        uint256 rsrTokenPrice,
        uint256[] calldata collateralTokenPrices
    ) external override {
        LibDiamond.enforceIsContractOwner();
        require(collateralTokenPrices.length == s.basket.size, "mismatch to basket");
        for (uint16 i = 0; i < s.basket.size; i++) {
            s.basket.tokens[i].priceInRToken = collateralTokenPrices[i];
        }
        s.rsr.priceInRToken = rsrTokenPrice;
    }
}
