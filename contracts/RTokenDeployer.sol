// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "./interfaces/ICircuitBreaker.sol";
import "./interfaces/IDEXRouter.sol";
import "./interfaces/IFeeERC20.sol";
import "./interfaces/IInsurancePool.sol";
import "./interfaces/IIssuance.sol";
import "./interfaces/IMetaTx.sol";
import "./interfaces/IOwnership.sol";
import "./interfaces/ITxFee.sol";

import "./libraries/Token.sol";

import "./RToken.sol";

/*
 * @title RTokenDeployer
 * @dev Static deployment of V1 of the Reserve Protocol.
 * Allows anyone to create insured basket currencies that have the ability to change collateral.
 */
contract RTokenDeployer {

    address immutable uniswapV3SwapRouter;

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
        uniswapV3SwapRouter = uniswapV3SwapRouterAddress;
        circuitBreakerFacet = address(new CircuitBreakerFacet());
        dexRouterFacet = address(new DEXRouterFacet());
        erc20Facet = address(new ERC20Facet());
        insurancePoolFacet = address(new InsurancePoolFacet());
        insurancePoolFacet = address(new IssuanceFacet());
        metaTxFacet = address(new MetaTxFacet());
        ownershipFacet = address(new OwnershipFacet());
        txFeeFacet = address(new TxFeeFacet());
    }

    function deploy(
        RToken.ConstructorArgs memory _args, 
        Token.Info[] memory _basket, 
        Token.Info memory _rsr
    )
        public
        returns (address rToken)
    {
        _args.uniswapV3SwapRouterAddress = uniswapV3SwapRouter;

        IDiamondCut.FacetCut[] memory cuts = new IDiamondCut.FacetCut[](9);

        // DiamondCut
        bytes4[] memory functionSelectors = new bytes4[](1);
        functionSelectors[0] = IDiamondCut.diamondCut.selector;
        cuts[0] = IDiamondCut.FacetCut({
            facetAddress: _diamondCutFacet, 
            action: IDiamondCut.FacetCutAction.Add, 
            functionSelectors: functionSelectors
        });

        // CircuitBreaker
        bytes4[] memory circuitSelectors = new bytes4[](1);
        circuitSelectors[0] = ICircuitBreaker.check.selector;
        cuts[1] = IDiamondCut.FacetCut({
            facetAddress: circuitBreakerFacet, 
            action: IDiamondCut.FacetCutAction.Add, 
            functionSelectors: circuitSelectors
        });

        // DEX Router
        bytes4[] memory dexRouterSelectors = new bytes4[](1);
        dexRouterSelectors[0] = IDEXRouter.tradeFixedSell.selector;
        cuts[2] = IDiamondCut.FacetCut({
            facetAddress: dexRouterFacet, 
            action: IDiamondCut.FacetCutAction.Add, 
            functionSelectors: dexRouterSelectors
        });


        // ERC20 
        bytes4[] memory erc20Selectors = new bytes4[](8);
        erc20Selectors[0] = IFeeERC20.setFeeEnabled.selector;
        erc20Selectors[1] = IFeeERC20.feeForTransfer.selector;
        erc20Selectors[2] = IFeeERC20.totalSupply.selector;
        erc20Selectors[3] = IFeeERC20.balanceOf.selector;
        erc20Selectors[4] = IFeeERC20.transfer.selector;
        erc20Selectors[5] = IFeeERC20.allowance.selector;
        erc20Selectors[6] = IFeeERC20.approve.selector;
        erc20Selectors[7] = IFeeERC20.transferFrom.selector;
        cuts[3] = IDiamondCut.FacetCut({
            facetAddress: erc20Facet, 
            action: IDiamondCut.FacetCutAction.Add, 
            functionSelectors: erc20Selectors
        });

        // InsurancePool
        bytes4[] memory insuranceSelectors = new bytes4[](7);
        insuranceSelectors[0] = IInsurancePool.balanceOf.selector;
        insuranceSelectors[1] = IInsurancePool.notifyRevenue.selector;
        insuranceSelectors[2] = IInsurancePool.stake.selector;
        insuranceSelectors[3] = IInsurancePool.exit.selector;
        insuranceSelectors[4] = IInsurancePool.initiateWithdrawal.selector;
        insuranceSelectors[5] = IInsurancePool.claimRevenue.selector;
        insuranceSelectors[6] = IInsurancePool.climb.selector;
        cuts[4] = IDiamondCut.FacetCut({
            facetAddress: insurancePoolFacet,, 
            action: IDiamondCut.FacetCutAction.Add, 
            functionSelectors: insuranceSelectors
        });

        // Issuance Facet
        bytes4[] memory issuanceSelectors = new bytes4[](8);
        issuanceSelectors[0] = IIssuance.noop.selector;
        issuanceSelectors[1] = IIssuance.issue.selector;
        issuanceSelectors[2] = IIssuance.redeem.selector;
        issuanceSelectors[3] = IIssuance.freezeTrading.selector;
        issuanceSelectors[4] = IIssuance.unfreezeTrading.selector;
        issuanceSelectors[5] = IIssuance.tradingFrozen.selector;
        issuanceSelectors[6] = IIssuance.issueAmounts.selector;
        issuanceSelectors[7] = IIssuance.redemptionAmounts.selector;
        cuts[5] = IDiamondCut.FacetCut({
            facetAddress: dexRouterFacet, 
            action: IDiamondCut.FacetCutAction.Add, 
            functionSelectors: issuanceSelectors
        });

        // MetaTx
        bytes4[] memory metaTxSelectors = new bytes4[](3);
        metaTxSelectors[0] = IMetaTx.getDomainSeparator.selector;
        metaTxSelectors[1] = IMetaTx.getNonce.selector;
        metaTxSelectors[2] = IMetaTx.executeMetaTransaction.selector;
        cuts[6] = IDiamondCut.FacetCut({
            facetAddress: metaTxFacet, 
            action: IDiamondCut.FacetCutAction.Add, 
            functionSelectors: metaTxSelectors
        });

        // Ownership
        bytes4[] memory ownershipSelectors = new bytes4[](3);
        ownershipSelectors[0] = IOwnership.updatePrices.selector;
        ownershipSelectors[1] = IOwnership.transferOwnership.selector;
        ownershipSelectors[2] = IOwnership.owner.selector;
        cuts[7] = IDiamondCut.FacetCut({
            facetAddress: ownershipFacet, 
            action: IDiamondCut.FacetCutAction.Add, 
            functionSelectors: ownershipSelectors
        });

        // TxFeeCalculator
        bytes4[] memory txFeeSelectors = new bytes4[](1);
        txFeeSelectors[0] = ITXFee.calculateFee.selector;
        cuts[8] = IDiamondCut.FacetCut({
            facetAddress: txFeeFacet, 
            action: IDiamondCut.FacetCutAction.Add, 
            functionSelectors: txFeeSelectors
        });

        // Create RToken using already-deployed facet contracts
        RToken rtoken = new RToken(cuts, _args, _basket, _rsr);
        rTokens[numRTokens] = address(rtoken);
        numRTokens++;
        return address(rtoken);
    }
}
