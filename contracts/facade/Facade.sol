// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";
import "../interfaces/IFacade.sol";

/*
 * @title Facade
 * @notice A Facade delegates execution to facets (implementions) as a function of selector.
 *   IMPORTANT: The functions should be stateless! They cannot rely on storage.
 */
// slither-disable-start
contract Facade is IFacade, Ownable {
    mapping(bytes4 => address) public facets;

    // solhint-disable-next-line no-empty-blocks
    constructor() Ownable() {}

    // Save new facets to the Facade, forcefully
    function save(address facet, bytes4[] memory selectors) external onlyOwner {
        require(facet != address(0), "zero address");
        for (uint256 i = 0; i < selectors.length; i++) {
            facets[selectors[i]] = facet;
            emit SelectorSaved(facet, selectors[i]);
        }
    }

    // Find the facet for function that is called and execute the
    // function if a facet is found and return any value.
    fallback() external {
        address facet = facets[msg.sig];
        require(facet != address(0), "facet does not exist");

        // Execute external function from facet using delegatecall and return any value.
        assembly {
            // copy function selector and any arguments
            calldatacopy(0, 0, calldatasize())
            // execute function call using the facet
            let result := delegatecall(gas(), facet, 0, calldatasize(), 0, 0)
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
