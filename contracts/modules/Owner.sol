// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "@openzeppelin/contracts-upgradeable/governance/TimelockControllerUpgradeable.sol";

import "../interfaces/IOwner.sol";
import "../interfaces/IRToken.sol";

contract Owner is IOwner, TimelockControllerUpgradeable {
    bytes32 public constant PRICES_ROLE = keccak256("PRICES_ROLE");

    function initialize(address admin_) external initializer {
        _setupRole(DEFAULT_ADMIN_ROLE, admin_);
        _setupRole(PRICES_ROLE, admin_);
        address[] memory proposers = new address[](1);
        address[] memory executors = new address[](1);
        proposers[0] = admin_;
        executors[0] = admin_;
        
        __TimelockController_init(0, proposers, executors);
    }

    /// Quantities collateral token necessary to have 1e18 RToken in value
    function updatePrices(
        address rTokenAddress,
        uint256 insuranceTokenPrice,
        uint256[] calldata collateralTokenPrices
    ) external override onlyRoleOrOpenRole(PRICES_ROLE) {
        uint16 basketSize = IRToken(rTokenAddress).basketSize();
        require(collateralTokenPrices.length == basketSize, "mismatch to basket");

        for (uint16 i = 0; i < basketSize; i++) {
            IRToken(rTokenAddress).setBasketTokenPriceInRToken(i, collateralTokenPrices[i]);
        }
        IRToken(rTokenAddress).setRSRPriceInRToken(insuranceTokenPrice);
    }
}
