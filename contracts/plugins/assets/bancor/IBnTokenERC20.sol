// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IBnTokenERC20 is IERC20{
    /// @notice Returns the present total value of all bnToken's assets denominated in underlying
    function poolTokenToUnderlying(address pool, uint256 poolTokenAmount) external view returns (uint256);
}
