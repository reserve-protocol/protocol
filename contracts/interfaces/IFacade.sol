// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "./IActFacet.sol";
import "./IReadFacet.sol";

interface IFacade {
    event SelectorSaved(address indexed facet, bytes4 indexed selector);

    // Save new facet to the Facade, forcefully
    function save(address facet, bytes4[] memory selectors) external;

    function facets(bytes4 selector) external view returns (address);
}

// solhint-disable-next-line no-empty-blocks
interface TestIFacade is IFacade, IActFacet, IReadFacet {

}
