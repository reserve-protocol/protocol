// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

interface IWrappedERC20 is IERC20Metadata {
    function allow(address account, bool isAllowed_) external;

    function hasPermission(address owner, address manager) external view returns (bool);

    function isAllowed(address first, address second) external returns (bool);
}
