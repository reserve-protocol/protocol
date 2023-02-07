// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "../assets/ATokenFiatCollateral.sol";

contract InvalidATokenFiatCollateralMock is ATokenFiatCollateral {
    constructor(CollateralConfig memory config, uint192 revenueHiding)
        ATokenFiatCollateral(config, revenueHiding)
    {}

    /// Reverting claimRewards function
    function claimRewards() external pure override {
        revert("claimRewards() error");
    }
}
