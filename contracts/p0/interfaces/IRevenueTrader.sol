// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "./IComponent.sol";
import "./IRewardClaimer.sol";
import "./IRevenueTrader.sol";
import "./ITrader.sol";

interface IRevenueTrader is IComponent, ITraderEvents, IRewardClaimerEvents {
    function manageFunds() external;

    function manageERC20(IERC20Metadata erc20) external;

    function claimAndSweepRewardsToMain() external;
}
