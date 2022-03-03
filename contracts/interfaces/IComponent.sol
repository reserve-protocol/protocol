// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "./IMain.sol";

interface IComponent {
    function initComponent(IMain main, ConstructorArgs calldata args) external;
}
