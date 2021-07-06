// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IRelayERC20 is IERC20 {
    function relayNonce(address account) external returns (uint256);

    function relayedTransfer(
        bytes calldata sig,
        address from,
        address to,
        uint256 amount,
        uint256 fee
    ) external;
}
