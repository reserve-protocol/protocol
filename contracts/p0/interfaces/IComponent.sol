// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "contracts/p0/interfaces/IMain.sol";

interface IComponent {
    function initComponent(IMain main, ConstructorArgs calldata args) external;
}
