// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/p0/assets/collateral/ATokenCollateralP0.sol";

contract AaveIncentivesControllerMock is IAaveIncentivesController {
    // TODO: Fill in functions in order to test rewards claiming

    function setClaimer(address user, address claimer) external override {}

    function claimRewardsOnBehalf(
        address[] calldata assets,
        uint256 amount,
        address user,
        address to
    ) external override returns (uint256 rewards) {}

    function getRewardsBalance(address[] calldata assets, address user) external view override returns (uint256 bal) {}
}
