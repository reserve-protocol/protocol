// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "./IComponent.sol";
import "./IRevenueTrader.sol";
import "./ITrader.sol";

interface IAuctioneer is IComponent, ITraderEvents {
    function manageFunds() external;

    function rsrTrader() external view returns (IRevenueTrader);

    function rTokenTrader() external view returns (IRevenueTrader);
}
