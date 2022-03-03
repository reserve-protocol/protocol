// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./IComponent.sol";
import "./ITrader.sol";

interface IRevenueTrader is IComponent, ITrader {
    function manageFunds() external;

    function manageERC20(IERC20 erc20) external;
}
