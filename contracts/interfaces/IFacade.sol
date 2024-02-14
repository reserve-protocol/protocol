// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

interface IFacade {
    event FunctionSaved(bytes4 indexed selector, address indexed impl);
    event FunctionUpdated(bytes4 indexed selector, address indexed impl);

    // Save new implementations to the Facade, reverting if any already exist
    function save(address impl, bytes4[] memory selectors) external;

    // Update an existing implementation, reverting if none exists
    function update(address impl, bytes4 selector) external;
}
