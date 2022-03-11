// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "./IComponent.sol";
import "./ITrading.sol";

interface IRevenueTrader is IComponent, ITrading {
    function manageFunds() external;
}
