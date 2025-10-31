// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.28;

import "../assets/FiatCollateral.sol";
import "./ERC20MockReentrant.sol";

// Use with ERC20MockReentrant.sol for reentrancy tests
contract FiatCollateralMockReentrant is FiatCollateral {
    constructor(CollateralConfig memory config) FiatCollateral(config) {}

    function claimRewards() external override(Asset, IRewardable) {
        ERC20MockReentrant(address(erc20)).claimRewards(); // force reentrancy
    }
}
