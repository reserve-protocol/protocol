// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "@openzeppelin/contracts/interfaces/IERC20.sol";

interface IrEARN is IERC20 {
    function pricePerShare() external view returns (uint256);
}
