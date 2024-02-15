// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

interface IFacade {
    event FunctionSaved(address indexed impl, bytes4 indexed selector);

    // Save new implementations to the Facade, forcefully
    function save(address impl, bytes4[] memory selectors) external;
}
