// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface Iwsteth is IERC20 {
    function stEthPerToken() external view returns (uint256);
}
