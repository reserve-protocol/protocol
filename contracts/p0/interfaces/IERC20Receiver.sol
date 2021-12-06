// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title IERC20Receiver
 * @notice Common interface for RToken melting + stRSR dividend donation.
 */
interface IERC20Receiver {
    function notifyOfDeposit(IERC20 erc20) external;
}
