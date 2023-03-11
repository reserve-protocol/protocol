// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IWrappedERC20 is IERC20 {
    function decimals() external view returns (uint8);

    function balanceOf(address account) external view returns (uint256);

    function totalSupply() external view returns (uint256);

    function allow(address account, bool isAllowed_) external;

    function hasPermission(address owner, address manager) external view returns (bool);

    function isAllowed(address first, address second) external returns (bool);
}
