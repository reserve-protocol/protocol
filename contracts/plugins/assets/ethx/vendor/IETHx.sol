// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.28;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { IStaderConfig } from "./IStaderConfig.sol";

interface IETHx is IERC20Metadata {
    function staderConfig() external view returns (IStaderConfig);
}
