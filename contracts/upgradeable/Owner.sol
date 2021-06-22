pragma solidity 0.8.4;

import "../zeppelin/access/AccessControlEnumerable.sol";
import "../zeppelin/governance/TimelockController.sol";
import "./Configuration.sol";

contract Owner is AccessControlEnumerable, TimelockController {
    bytes32 public constant PRICES_ROLE = keccak256("PRICES_ROLE");
    bytes32 public constant SNAPSHOT_ROLE = keccak256("SNAPSHOT_ROLE");

    Configuration public conf;

    constructor (address admin_) TimelockController(0, [], []) {
        grantRole(PRICES_ROLE, admin_);
        grantRole(SNAPSHOT_ROLE, admin_);
    }

    /// Quantities collateral token necessary to have 1e18 RToken in value
    function updatePrices(
        uint256 insuranceTokenPrice, 
        uint256[] calldata collateralTokenPrices
    ) external onlyRoleOrOpenRole(PRICES_ROLE) {
        require(collateralTokenPrices.length == conf.getBasketSize(), "mismatch to basket");
        for (uint256 i = 0; i < collateralTokenPrices.length; i++) {
            conf.setBasketTokenPriceInRToken(i, collateralTokenPrices[i]);
        }
        conf.setInsuranceTokenPriceInRToken(insuranceTokenPrice);
    }

    function takeSnapshot() external onlyRoleOrOpenRole(SNAPSHOT_ROLE) {
        conf.takeSnapshot();
    }

}
