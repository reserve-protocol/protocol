// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "../facade/facets/ActFacet.sol";
import "../facade/facets/ReadFacet.sol";
import "../facade/facets/MaxIssuableFacet.sol";

interface IFacade {
    event SelectorSaved(address indexed facet, bytes4 indexed selector);

    // Save new facet to the Facade, forcefully
    function save(address facet, bytes4[] memory selectors) external;

    function facets(bytes4 selector) external view returns (address);
}

// solhint-disable-next-line no-empty-blocks
abstract contract TestIFacade is IFacade, ActFacet, MaxIssuableFacet, ReadFacet {

}
