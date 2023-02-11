// SPDX-License-Identifier: ISC
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IWrappedERC20 is IERC20 {
    function allow(address account, bool isAllowed_) external;

    function hasPermission(address owner, address manager) external view returns (bool);

    function isAllowed(address first, address second) external returns (bool);
}
