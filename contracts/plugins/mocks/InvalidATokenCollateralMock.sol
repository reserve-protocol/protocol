// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "../assets/aave/ATokenCollateral.sol";

contract InvalidATokenCollateralMock is ATokenCollateral {
    constructor(CollateralConfig memory config, uint192 revenueHiding)
        ATokenCollateral(config, revenueHiding)
    {}

    /// Reverting claimRewards function
    function claimRewards() external pure override {
        revert("claimRewards() error");
    }
}
