// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20VotesUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/MathUpgradeable.sol";

import "./libraries/Basket.sol";
import "./libraries/LibDiamond.sol";
import "./libraries/Token.sol";
import "./interfaces/ITXFee.sol";
import "./interfaces/IRToken.sol";
import "./interfaces/IAtomicExchange.sol";
import "./interfaces/IInsurancePool.sol";
import "./interfaces/ICircuitBreaker.sol";
import "./interfaces/IDiamondCut.sol";



contract RTokenDiamond {    
    AppStorage s;

    struct ConstructorArgs {
        address owner;
        address uniswapV3SwapRouterAddress;
        string name;
        string symbol;
        uint256 stakingDepositDelay;
        uint256 stakingWithdrawalDelay;
        uint256 maxSupply;
        uint256 minMintingSize;
        uint256 supplyExpansionRate;
        uint256 revenueBatchSize;
        uint256 expenditureFactor;
        uint256 spread;
        uint256 issuanceRate;
        uint256 tradingFreezeCost;
        address protocolFund;
    }

    constructor(IDiamondCut.FacetCut[] _diamondCut, ConstructorArgs memory _args, Token[] memory _basket, Token memory _rsr) payable {        
        LibDiamond.setContractOwner(_args.owner);

        // Add the diamondCut external function from the diamondCutFacet
        IDiamondCut.FacetCut[] memory cut = new IDiamondCut.FacetCut[](6);
        bytes4[] memory functionSelectors = new bytes4[](1);
        functionSelectors[0] = IDiamondCut.diamondCut.selector;
        cut[0] = IDiamondCut.FacetCut({
            facetAddress: _diamondCutFacet, 
            action: IDiamondCut.FacetCutAction.Add, 
            functionSelectors: functionSelectors
        });

        LibDiamond.diamondCut(_diamondCut, address(0), "");        

        s.dexSwapper = ISwapRouter(_args.uniswapV3SwapRouterAddress);
        s.name = s.name;
        s.symbol = s.symbol;
        s.stakingDepositDelay = _args.stakingDepositDelay;
        s.stakingWithdrawalDelay = _args.stakingWithdrawalDelay;
        s.maxSupply = _args.maxSupply;
        s.minMintingSize = _args.minMintingSize;
        s.supplyExpansionRate = _args.supplyExpansionRate;
        s.revenueBatchSize = _args.revenueBatchSize;
        s.expenditureFactor = _args.expenditureFactor;
        s.spread = _args.spread;
        s.issuanceRate = _args.issuanceRate;
        s.tradingFreezeCost = _args.tradingFreezeCost;
        s.protocolFund = _args.protocolFund;
        s.basket = _basket;
        s.rsr = _rsr;
    }

    // Find facet for function that is called and execute the
    // function if a facet is found and return any value.
    fallback() external payable {
        LibDiamond.DiamondStorage storage ds;
        bytes32 position = LibDiamond.DIAMOND_STORAGE_POSITION;
        assembly {
            ds.slot := position
        }
        address facet = ds.selectorToFacetAndPosition[msg.sig].facetAddress;
        require(facet != address(0), "Diamond: Function does not exist");
        assembly {
            calldatacopy(0, 0, calldatasize())
            let result := delegatecall(gas(), facet, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch result
                case 0 {
                    revert(0, returndatasize())
                }
                default {
                    return(0, returndatasize())
                }
        }
    }

    receive() external payable {}
}

