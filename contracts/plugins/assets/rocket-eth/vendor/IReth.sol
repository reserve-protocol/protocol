// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

/// External Interface for RETH
interface IReth is IERC20Metadata {
    function getExchangeRate() external view returns (uint256);
}
