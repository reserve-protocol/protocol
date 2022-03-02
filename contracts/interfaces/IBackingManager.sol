// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./IComponent.sol";
import "./ITrader.sol";

interface IBackingManager is IComponent, ITrader {
    function withdraw(
        IERC20 erc20,
        address account,
        uint256 amount
    ) external;

    function manageFunds() external;
}
