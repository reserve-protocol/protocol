// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "../libraries/DiamondStorage.sol";
import "../interfaces/IERC173.sol";

contract OwnershipFacet is Context, IERC173 {
    using DiamondStorage for DiamondStorage;

    DiamondStorage.Info internal ds;

    function transferOwnership(address _newOwner) external override {
        ds.enforceIsContractOwner(_msgSender());
        DiamondStorage.setContractOwner(_newOwner);
    }

    function owner() external override view returns (address owner_) {
        owner_ = ds.contractOwner();
    }

    /// Quantities collateral token necessary to have 1e18 RToken in value
    function updatePrices(
        uint256 rsrTokenPrice,
        uint256[] calldata collateralTokenPrices
    ) external override {
        ds.enforceIsContractOwner(_msgSender());
        require(collateralTokenPrices.length == ds.basket.size, "mismatch to basket");
        for (uint16 i = 0; i < ds.basket.size; i++) {
            s.basket.tokens[i].priceInRToken = collateralTokenPrices[i];
        }
        ds.rsr.priceInRToken = rsrTokenPrice;
    }
}
