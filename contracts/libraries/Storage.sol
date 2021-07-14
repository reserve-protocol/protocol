// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "../interfaces/IDiamondCut.sol";
import "../facets/CircuitBreakerFacet.sol";
import "../facets/DEXRouterFacet.sol";
import "../facets/ERC20Facet.sol";
import "../facets/InsurancePoolFacet.sol";
import "../facets/IssuanceFacet.sol";
import "../facets/MetaTxFacet.sol";
import "../facets/OwnershipFacet.sol";
import "./Token.sol";


library DiamondStorage {

    bytes32 constant CIRCUIT_BREAKER_STORAGE_POSITION = keccak256("rtoken.circuit.breaker.storage");
    bytes32 constant DEX_ROUTER_STORAGE_POSITION = keccak256("rtoken.dex.router.storage");
    bytes32 constant ERC20_STORAGE_POSITION = keccak256("rtoken.erc20.storage");
    bytes32 constant INSURANCE_POOL_STORAGE_POSITION = keccak256("rtoken.insurance.pool.storage");
    bytes32 constant ISSUANCE_STORAGE_POSITION = keccak256("rtoken.issuance.storage");
    bytes32 constant META_TX_STORAGE_POSITION = keccak256("rtoken.meta.tx.storage");

    struct Info {
        // maps function selector to the facet address and
        // the position of the selector in the facetFunctionSelectors.selectors array
        mapping(bytes4 => FacetAddressAndPosition) selectorToFacetAndPosition;
        // maps facet addresses to function selectors
        mapping(address => FacetFunctionSelectors) facetFunctionSelectors;
        // facet addresses
        address[] facetAddresses;
        // Used to query if a contract implements an interface.
        // Used to implement ERC-165.
        mapping(bytes4 => bool) supportedInterfaces;
        // owner of the contract
        address contractOwner;

        // ==== Diamond-wide data ====
        uint256 timestampDeployed;
        Basket basket;
        Token.Info rsr;

    }

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    function setContractOwner(DiamondStorage.Info storage ds, address _newOwner) internal {
        address previousOwner = ds.contractOwner;
        ds.contractOwner = _newOwner;
        emit OwnershipTransferred(previousOwner, _newOwner);
    }

    function enforceIsContractOwner(DiamondStorage.Info storage ds, address account) internal view {
        require(account == ds.contractOwner, "DiamondStorage: Must be contract owner");
    }

    // ==== DiamondStorage ====

    struct FacetAddressAndPosition {
        address facetAddress;
        uint16 functionSelectorPosition; // position in facetFunctionSelectors.functionSelectors array
    }

    struct FacetFunctionSelectors {
        bytes4[] functionSelectors;
        uint16 facetAddressPosition; // position of facetAddress in facetAddresses array
    }

    event DiamondCut(IDiamondCut.FacetCut[] _diamondCut, address _init, bytes _calldata);

    // Internal function version of diamondCut
    function diamondCut(
        DiamondStorage.Info storage ds, 
        IDiamondCut.FacetCut[] memory _diamondCut,
        address _init,
        bytes memory _calldata
    ) internal {
        for (uint256 facetIndex; facetIndex < _diamondCut.length; facetIndex++) {
            IDiamondCut.FacetCutAction action = _diamondCut[facetIndex].action;
            if (action == IDiamondCut.FacetCutAction.Add) {
                addFunctions(_diamondCut[facetIndex].facetAddress, _diamondCut[facetIndex].functionSelectors);
            } else if (action == IDiamondCut.FacetCutAction.Replace) {
                replaceFunctions(_diamondCut[facetIndex].facetAddress, _diamondCut[facetIndex].functionSelectors);
            } else if (action == IDiamondCut.FacetCutAction.Remove) {
                removeFunctions(_diamondCut[facetIndex].facetAddress, _diamondCut[facetIndex].functionSelectors);
            } else {
                revert("DiamondStorageCut: Incorrect FacetCutAction");
            }
        }
        emit DiamondCut(_diamondCut, _init, _calldata);
        initializeDiamondCut(_init, _calldata);
    }

    function addFunctions(DiamondStorage.Info storage ds, address _facetAddress, bytes4[] memory _functionSelectors) internal {
        require(_functionSelectors.length > 0, "DiamondStorageCut: No selectors in facet to cut");
        require(_facetAddress != address(0), "DiamondStorageCut: Add facet can't be address(0)");
        uint16 selectorPosition = uint16(ds.facetFunctionSelectors[_facetAddress].functionSelectors.length);
        // add new facet address if it does not exist
        if (selectorPosition == 0) {
            enforceHasContractCode(_facetAddress, "DiamondStorageCut: New facet has no code");
            ds.facetFunctionSelectors[_facetAddress].facetAddressPosition = uint16(ds.facetAddresses.length);
            ds.facetAddresses.push(_facetAddress);
        }
        for (uint256 selectorIndex; selectorIndex < _functionSelectors.length; selectorIndex++) {
            bytes4 selector = _functionSelectors[selectorIndex];
            address oldFacetAddress = ds.selectorToFacetAndPosition[selector].facetAddress;
            require(oldFacetAddress == address(0), "DiamondStorageCut: Can't add function that already exists");
            ds.facetFunctionSelectors[_facetAddress].functionSelectors.push(selector);
            ds.selectorToFacetAndPosition[selector].facetAddress = _facetAddress;
            ds.selectorToFacetAndPosition[selector].functionSelectorPosition = selectorPosition;
            selectorPosition++;
        }
    }

    function replaceFunctions(DiamondStorage.Info storage ds, address _facetAddress, bytes4[] memory _functionSelectors) internal {
        require(_functionSelectors.length > 0, "DiamondStorageCut: No selectors in facet to cut");
        require(_facetAddress != address(0), "DiamondStorageCut: Add facet can't be address(0)");
        uint16 selectorPosition = uint16(ds.facetFunctionSelectors[_facetAddress].functionSelectors.length);
        // add new facet address if it does not exist
        if (selectorPosition == 0) {
            enforceHasContractCode(_facetAddress, "DiamondStorageCut: New facet has no code");
            ds.facetFunctionSelectors[_facetAddress].facetAddressPosition = uint16(ds.facetAddresses.length);
            ds.facetAddresses.push(_facetAddress);
        }
        for (uint256 selectorIndex; selectorIndex < _functionSelectors.length; selectorIndex++) {
            bytes4 selector = _functionSelectors[selectorIndex];
            address oldFacetAddress = ds.selectorToFacetAndPosition[selector].facetAddress;
            require(oldFacetAddress != _facetAddress, "DiamondStorageCut: Can't replace function with same function");
            removeFunction(oldFacetAddress, selector);
            // add function
            ds.selectorToFacetAndPosition[selector].functionSelectorPosition = selectorPosition;
            ds.facetFunctionSelectors[_facetAddress].functionSelectors.push(selector);
            ds.selectorToFacetAndPosition[selector].facetAddress = _facetAddress;
            selectorPosition++;
        }
    }

    function removeFunctions(DiamondStorage.Info storage ds, address _facetAddress, bytes4[] memory _functionSelectors) internal {
        require(_functionSelectors.length > 0, "DiamondStorageCut: No selectors in facet to cut");
        // if function does not exist then do nothing and return
        require(_facetAddress == address(0), "DiamondStorageCut: Remove facet address must be address(0)");
        for (uint256 selectorIndex; selectorIndex < _functionSelectors.length; selectorIndex++) {
            bytes4 selector = _functionSelectors[selectorIndex];
            address oldFacetAddress = ds.selectorToFacetAndPosition[selector].facetAddress;
            removeFunction(oldFacetAddress, selector);
        }
    }

    function removeFunction(DiamondStorage.Info storage ds, address _facetAddress, bytes4 _selector) internal {
        require(_facetAddress != address(0), "DiamondStorageCut: Can't remove function that doesn't exist");
        // an immutable function is a function defined directly in a diamond
        require(_facetAddress != address(this), "DiamondStorageCut: Can't remove immutable function");
        // replace selector with last selector, then delete last selector
        uint256 selectorPosition = ds.selectorToFacetAndPosition[_selector].functionSelectorPosition;
        uint256 lastSelectorPosition = ds.facetFunctionSelectors[_facetAddress].functionSelectors.length - 1;
        // if not the same then replace _selector with lastSelector
        if (selectorPosition != lastSelectorPosition) {
            bytes4 lastSelector = ds.facetFunctionSelectors[_facetAddress].functionSelectors[lastSelectorPosition];
            ds.facetFunctionSelectors[_facetAddress].functionSelectors[selectorPosition] = lastSelector;
            ds.selectorToFacetAndPosition[lastSelector].functionSelectorPosition = uint16(selectorPosition);
        }
        // delete the last selector
        ds.facetFunctionSelectors[_facetAddress].functionSelectors.pop();
        delete ds.selectorToFacetAndPosition[_selector];

        // if no more selectors for facet address then delete the facet address
        if (lastSelectorPosition == 0) {
            // replace facet address with last facet address and delete last facet address
            uint256 lastFacetAddressPosition = ds.facetAddresses.length - 1;
            uint256 facetAddressPosition = ds.facetFunctionSelectors[_facetAddress].facetAddressPosition;
            if (facetAddressPosition != lastFacetAddressPosition) {
                address lastFacetAddress = ds.facetAddresses[lastFacetAddressPosition];
                ds.facetAddresses[facetAddressPosition] = lastFacetAddress;
                ds.facetFunctionSelectors[lastFacetAddress].facetAddressPosition = uint16(facetAddressPosition);
            }
            ds.facetAddresses.pop();
            delete ds.facetFunctionSelectors[_facetAddress].facetAddressPosition;
        }
    }

    function initializeDiamondCut(address _init, bytes memory _calldata) internal {
        if (_init == address(0)) {
            require(_calldata.length == 0, "DiamondStorageCut: _init is address(0) but_calldata is not empty");
        } else {
            require(_calldata.length > 0, "DiamondStorageCut: _calldata is empty but _init is not address(0)");
            if (_init != address(this)) {
                enforceHasContractCode(_init, "DiamondStorageCut: _init address has no code");
            }
            (bool success, bytes memory error) = _init.delegatecall(_calldata);
            if (!success) {
                if (error.length > 0) {
                    // bubble up the error
                    revert(string(error));
                } else {
                    revert("DiamondStorageCut: _init function reverted");
                }
            }
        }
    }

    function enforceHasContractCode(address _contract, string memory _errorMessage) internal view {
        uint256 contractSize;
        assembly {
            contractSize := extcodesize(_contract)
        }
        require(contractSize > 0, _errorMessage);
    }

    // ==== ds ====

    function circuitBreakerStorage() internal pure returns (CircuitBreakerFacet.CircuitBreakerStorage storage s) {
        bytes32 position = CIRCUIT_BREAKER_STORAGE_POSITION;
        assembly {
            s.slot := position
        }
    }


    function dexRouterStorage() internal pure returns (DexRouterFacet.DexRouterStorage storage s) {
        bytes32 position = DEX_ROUTER_STORAGE_POSITION;
        assembly {
            s.slot := position
        }
    }


    function erc20Storage() internal pure returns (ERC20Facet.Erc20Storage storage s) {
        bytes32 position = ERC20_STORAGE_POSITION;
        assembly {
            s.slot := position
        }
    }


    function insurancePoolStorage() internal pure returns (InsurancePoolFacet.InsurancePoolStorage storage s) {
        bytes32 position = INSURANCE_POOL_STORAGE_POSITION;
        assembly {
            s.slot := position
        }
    }


    function issuanceStorage() internal pure returns (IssuanceFacet.IssuanceStorage storage s) {
        bytes32 position = ISSUANCE_STORAGE_POSITION;
        assembly {
            s.slot := position
        }
    }

    function metaTxStorage() internal pure returns (MetaTxFacet.MetaTxStorage storage s) {
        bytes32 position = META_TX_STORAGE_POSITION;
        assembly {
            s.slot := position
        }
    }
}

