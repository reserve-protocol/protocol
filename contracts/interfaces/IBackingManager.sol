// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/libraries/Fixed.sol";
import "./IComponent.sol";
import "./ITrading.sol";

interface IBackingManager is IComponent, ITrading {
    event AuctionDelaySet(uint256 indexed oldVal, uint256 indexed newVal);
    event BackingBufferSet(int192 indexed oldVal, int192 indexed newVal);

    function grantAllowances() external;

    function manageFunds() external;
}
