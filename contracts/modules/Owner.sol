// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "../external/zeppelin/governance/TimelockController.sol";
import "../interfaces/IConfiguration.sol";
import "../interfaces/IOwner.sol";
import "../interfaces/IRToken.sol";

contract Owner is IOwner, TimelockController {
    bytes32 public constant PRICES_ROLE = keccak256("PRICES_ROLE");
    bytes32 public constant SNAPSHOT_ROLE = keccak256("SNAPSHOT_ROLE");

    constructor (address admin_) TimelockController(0, new address[](0), new address[](0)) {
        grantRole(PRICES_ROLE, admin_);
        grantRole(SNAPSHOT_ROLE, admin_);
    }

    /// Quantities collateral token necessary to have 1e18 RToken in value
    function updatePrices(
        address rTokenAddress,
        uint256 insuranceTokenPrice, 
        uint256[] calldata collateralTokenPrices
    ) external override onlyRoleOrOpenRole(PRICES_ROLE) {
        IRToken rtoken = IRToken(rTokenAddress);
        IConfiguration conf = rtoken.conf();
        require(collateralTokenPrices.length == conf.getBasketSize(), "mismatch to basket");

        for (uint256 i = 0; i < collateralTokenPrices.length; i++) {
            conf.setBasketTokenPriceInRToken(i, collateralTokenPrices[i]);
        }
        conf.setInsuranceTokenPriceInRToken(insuranceTokenPrice);
    }

    function takeSnapshot(
        address rTokenAddress
    ) external override onlyRoleOrOpenRole(SNAPSHOT_ROLE) returns (uint256) {
        IRToken rtoken = IRToken(rTokenAddress);
        return rtoken.takeSnapshot();
    }

}
