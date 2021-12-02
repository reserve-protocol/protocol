// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title IERC20Receiver
 * @notice Common interface for RToken melting + stRSR dividend donation.
 */
interface IERC20Receiver {
    function receiveERC20(IERC20 erc20, uint256 amount) external;

    function erc20Wanted() external view returns (IERC20);
}
