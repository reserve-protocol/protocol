// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "./modules/InsurancePool.sol";
import "./modules/Owner.sol";
import "./libraries/Token.sol";
import "./RTokenDiamond.sol";

/*
 * @title RTokenDeployer
 * @dev Static deployment of V1 of the Reserve Protocol.
 * Allows anyone to create insured basket currencies that have the ability to change collateral.
 */
contract RTokenDeployer {

    address immutable circuitBreakerFacet;
    address immutable dexRouterFacet;
    address immutable erc20Facet;
    address immutable insurancePoolFacet;
    address immutable issuanceFacet;
    address immutable metaTxFacet;
    address immutable ownershipFacet;
    address immutable txFeeFacet;

    mapping (uint256 => address) rTokens;
    uint256 numRTokens;

    constructor(address uniswapV3SwapRouterAddress) {
        circuitBreakerFacet = address(new CircuitBreakerFacet());
        dexRouterFacet = address(new DEXRouterFacet(uniswapV3SwapRouterAddress));
        erc20Facet = address(new ERC20Facet());
        insurancePoolFacet = address(new InsurancePoolFacet());
        insurancePoolFacet = address(new IssuanceFacet());
        metaTxFacet = address(new MetaTxFacet());
        ownershipFacet = address(new OwnershipFacet());
        txFeeFacet = address(new TxFeeFacet());
    }

    function deploy(
        RTokenDiamond.ConstructorArgs memory _args, 
        Token[] memory _basket, 
        Token memory _rsr
    )
        public
        returns (address rToken)
    {


        IDiamondCut.FacetCut[] memory cuts = new IDiamondCut.FacetCut[](6);

        // DiamondCut
        bytes4[] memory functionSelectors = new bytes4[](1);
        functionSelectors[0] = IDiamondCut.diamondCut.selector;
        cuts[0] = IDiamondCut.FacetCut({
            facetAddress: _diamondCutFacet, 
            action: IDiamondCut.FacetCutAction.Add, 
            functionSelectors: functionSelectors
        });

        // CircuitBreaker
        bytes4[] memory functionSelectors = new bytes4[](1);
        functionSelectors[0] = IDiamondCut.diamondCut.selector;
        cuts[0] = IDiamondCut.FacetCut({
            facetAddress: _diamondCutFacet, 
            action: IDiamondCut.FacetCutAction.Add, 
            functionSelectors: functionSelectors
        });

        // Etc...

        // Create RToken using deployed facet contracts
        RTokenDiamond rtoken = new RTokenDiamond(cuts, _args, _basket, _rsr);
        rTokens[numRTokens] = address(rtoken);
        numRTokens++;
        return address(rtoken);
    }
}
