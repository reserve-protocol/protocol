// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface INTokenERC20Proxy is IERC20 {
    /// @notice Returns the present total value of all nToken's assets denominated in underlying
    function getPresentValueUnderlyingDenominated() external view returns (int256);

    /// @notice Total number of tokens in circulation
    function totalSupply() external view returns (uint256);
}