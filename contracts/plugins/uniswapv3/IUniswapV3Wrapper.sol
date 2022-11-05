// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IUniswapV3Wrapper is IERC20 {
    function increaseLiquidity(uint256 amount0, uint256 amount1) external returns (uint256); //mint

    function decreaseLiquidity(uint256 amount) external returns (uint256); //burn

    function token0() external view returns (IERC20); //TODO maybe

    function token1() external view returns (IERC20);

    function positionId() external view returns (uint256);
}
