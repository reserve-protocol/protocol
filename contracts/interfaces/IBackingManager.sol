// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/libraries/Fixed.sol";
import "./IComponent.sol";
import "./ITrader.sol";

interface IBackingManager is IComponent, ITrader {
    event AuctionDelaySet(uint256 indexed oldVal, uint256 indexed newVal);
    event BackingBufferSet(Fix indexed oldVal, Fix indexed newVal);

    function grantAllowances() external;

    function manageFunds() external;
}
