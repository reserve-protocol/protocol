// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20VotesUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/MathUpgradeable.sol";

import "./libraries/Storage.sol";
import "./libraries/Token.sol";
import "./interfaces/ITXFee.sol";
import "./interfaces/IIssuance.sol";
import "./interfaces/IDEXRouter.sol";
import "./interfaces/IInsurancePool.sol";
import "./interfaces/ICircuitBreaker.sol";
import "./interfaces/IDiamondCut.sol";



contract RToken {    
    using DiamondStorage for DiamondStorage.Info;

    DiamondStorage.Info ds;

    struct ConstructorArgs {
        address owner;
        address uniswapV3SwapRouterAddress;
        string name;
        string symbol;

        /// Recipient of expenditures. 
        address protocolFund;

        /// RSR staking deposit delay (s)
        /// e.g. 2_592_000 => Newly staked RSR tokens take 1 month to enter the insurance pool
        uint256 stakingDepositDelay;
        /// RSR staking withdrawal delay (s)
        /// e.g. 2_592_000 => Currently staking RSR tokens take 1 month to withdraw
        uint256 stakingWithdrawalDelay;
        /// RToken max supply
        /// e.g. 1_000_000e18 => 1M max supply
        uint256 maxSupply;

        /// Percentage rates are relative to 1e18.

        /// Minimum minting amount
        /// e.g. 1_000e18 => 1k RToken 
        uint256 minMintingSize;
        /// RToken annual supply-expansion rate, scaled
        /// e.g. 1.23e16 => 1.23% annually
        uint256 supplyExpansionRate;
        /// RToken revenue batch sizes
        /// e.g. 1e15 => 0.1% of the RToken supply
        uint256 revenueBatchSize;
        /// Protocol expenditure factor
        /// e.g. 1e16 => 1% of the RToken supply expansion goes to protocol fund
        uint256 expenditureFactor;
        /// Issuance/Redemption spread
        /// e.g. 1e14 => 0.01% spread
        uint256 spread;
        /// RToken issuance blocklimit
        /// e.g. 25_000e18 => 25_000e18 (atto)RToken can be issued per block
        uint256 issuanceRate;
        /// Cost of freezing trading (in RSR)
        /// e.g. 100_000_000e18 => 100M RSR
        uint256 tradingFreezeCost;
    }

    constructor(IDiamondCut.FacetCut[] _diamondCut, ConstructorArgs memory _args, Token[] memory _basket, Token memory _rsr) payable {
        // Diamond Storage

        DiamondStorage.diamondCut(_diamondCut, address(0), "");
        DiamondStorage.setContractOwner(_args.owner);
        ds.basket = _basket;
        ds.rsr = _rsr;
        ds.timestampDeployed = block.timestamp;

        // ERC165 data

        ds.supportedInterfaces[type(IERC165).interfaceId] = true;
        ds.supportedInterfaces[type(IDiamondCut).interfaceId] = true;
        ds.supportedInterfaces[type(IDiamondLoupe).interfaceId] = true;
        ds.supportedInterfaces[type(IERC173).interfaceId] = true;

        // Facet storage

        DEXRouterFacet.DEXRouterStorage storage dexRouterStorage = ds.dexRouterStorage();
        dexRouterStorage.swapper = ISwapRouter(_args.uniswapV3SwapRouterAddress);

        ERC20Facet.ERC20Storage storage erc20Storage = ds.erc20Storage();
        erc20Storage.maxSupply = _args.maxSupply;

        InsurancePoolFacet.InsurancePoolStorage storage insurancePoolStorage = ds.insurancePoolStorage();
        insurancePoolStorage.stakingDepositDelay = _args.stakingDepositDelay;
        insurancePoolStorage.withdrawalDepositDelay = _args.stakingWithdrawalDelay;

        IssuanceFacet.IssuanceStorage storage issuanceStorage = ds.issuanceStorage();
        issuanceStorage.name = _args.name;
        issuanceStorage.symbol = _args.symbol;
        issuanceStorage.minMintingSize = _args.minMintingSize;
        issuanceStorage.supplyExpansionRate = _args.supplyExpansionRate;
        issuanceStorage.revenueBatchSize = _args.revenueBatchSize;
        issuanceStorage.expenditureFactor = _args.expenditureFactor;
        issuanceStorage.spread = _args.spread;
        issuanceStorage.issuanceRate = _args.issuanceRate;
        issuanceStorage.tradingFreezeCost = _args.tradingFreezeCost;
        issuanceStorage.protocolFund = _args.protocolFund;
        issuanceStorage.lastBlock = block.number;
        issuanceStorage.lastTimestamp = block.timestamp;
    }

    // Find facet for function that is called and execute the
    // function if a facet is found and return any value.
    fallback() external payable {
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

