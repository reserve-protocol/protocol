// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";
import "../interfaces/IFacade.sol";

/*
 * @title Facade
 * @notice A simple nearly-append-only list of functions that can be dynamically controlled
 *   IMPORTANT: The functions should be stateless! They cannot rely on storage.
 */
contract Facade is IFacade, Ownable {
    mapping(bytes4 => address) public impls; // version = index + 1

    // solhint-disable-next-line no-empty-blocks
    constructor() Ownable() {}

    // Save new implementations to the Facade, forcefully
    function save(address impl, bytes4[] memory selectors) external onlyOwner {
        require(impl != address(0), "zero address");
        for (uint256 i = 0; i < selectors.length; i++) {
            impls[selectors[i]] = impl;
            emit FunctionSaved(impl, selectors[i]);
        }
    }

    // Find impl for function that is called and execute the
    // function if a impl is found and return any value.
    fallback() external {
        address impl = impls[msg.sig];
        require(impl != address(0), "impl does not exist");

        // Execute external function from impl using delegatecall and return any value.
        assembly {
            // copy function selector and any arguments
            calldatacopy(0, 0, calldatasize())
            // execute function call using the impl
            let result := delegatecall(gas(), impl, 0, calldatasize(), 0, 0)
            // get any return value
            returndatacopy(0, 0, returndatasize())
            // return any return value or error back to the caller
            switch result
            case 0 {
                revert(0, returndatasize())
            }
            default {
                return(0, returndatasize())
            }
        }
    }
}
