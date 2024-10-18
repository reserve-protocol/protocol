// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "../../plugins/assets/DemurrageCollateral.sol";
import "../../plugins/assets/UnpricedCollateral.sol";

/**
 * @title CollateralFactory
 */
contract CollateralFactory {
    event DemurrageCollateralDeployed(address indexed collateral);
    event UnpricedCollateralDeployed(address indexed collateral);

    bytes32 public constant USD = bytes32("USD");

    function deployNewDemurrageCollateral(
        CollateralConfig memory config,
        DemurrageConfig memory demurrageConfig
    ) external returns (address newCollateral) {
        if (demurrageConfig.isFiat) {
            require(config.targetName == USD, "isFiat only compatible with USD");
        }

        newCollateral = address(new DemurrageCollateral(config, demurrageConfig));
        emit DemurrageCollateralDeployed(newCollateral);
    }

    function deployNewUnpricedCollateral(IERC20Metadata _erc20)
        external
        returns (address newCollateral)
    {
        newCollateral = address(new UnpricedCollateral(_erc20));
        emit UnpricedCollateralDeployed(newCollateral);
    }
}
