// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "../assets/aave/ATokenFiatCollateral.sol";

contract InvalidATokenFiatCollateralMock is ATokenFiatCollateral {
    constructor(CollateralConfig memory config, uint192 revenueHiding)
        ATokenFiatCollateral(config, revenueHiding)
    {}

    /// Reverting claimRewards function
    /// DEPRECATED: claimRewards() will be removed from all assets and collateral plugins
    function claimRewards() external pure override {
        revert("claimRewards() error");
    }
}
