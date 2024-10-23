// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "../../plugins/assets/DemurrageCollateral.sol";

/**
 * @title DemurrageCollateralFactory
 */
contract DemurrageCollateralFactory {
    event DemurrageCollateralDeployed(address indexed collateral);

    // collateral address => fee per second
    mapping(address => uint192) public demurrageDeployments;

    bytes32 public constant USD = bytes32("USD");

    function deployNewDemurrageCollateral(
        CollateralConfig memory config,
        DemurrageConfig memory demurrageConfig
    ) external returns (address newCollateral) {
        if (demurrageConfig.isFiat) {
            require(config.targetName == USD, "isFiat only compatible with USD");
        }

        newCollateral = address(new DemurrageCollateral(config, demurrageConfig));
        demurrageDeployments[newCollateral] = demurrageConfig.fee;
        emit DemurrageCollateralDeployed(newCollateral);
    }
}
