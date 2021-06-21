// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "./interfaces/IConfiguration.sol";
import "./zeppelin/governance/TimelockController.sol";
import "./upgradeable/SimpleOrderbookExchange.sol";
import "./upgradeable/InsurancePool.sol";
import "./upgradeable/Configuration.sol";
import "./RToken.sol";

/*
 * @title ReserveProtocolV1
 * @dev Static deployment of V1 of the Reserve Protocol. 
 * Allows anyone to create insured basket currencies that have the ability to change collateral. 
 */
contract ReserveProtocolV1 {

    address public immutable exchangeAddress;

    constructor () {
        exchangeAddress = address(new SimpleOrderbookExchange());
    }

    function deploy(
        bool timelockGovernance,
        address owner,
        string calldata name, 
        string calldata symbol,
        address[] memory tokenAddresses, 
        uint256[] memory tokenQuantities, 
        uint256[] memory tokenRateLimits, 
        uint256 auctionLengthSeconds,
        uint256 auctionSpacingSeconds,
        uint256 rsrDepositDelaySeconds,
        uint256 rsrWithdrawalDelaySeconds,
        uint256 maxSupply,
        uint256 supplyExpansionRateScaled,
        uint256 revenueBatchSizeScaled,
        uint256 expenditureFactorScaled,
        uint256 spreadScaled, 
        uint256 issuanceBlockLimit,
        uint256 freezeTradingCost,
        uint256 rsrSellRate,
        uint256 rsrMinBuyRate,
        address rsrTokenAddress,
        address circuitBreakerAddress,
        address txFeeAddress,
        address insurancePoolAddress,
        address protocolFundAddress
    ) public returns (
        address rToken, 
        address insurancePool, 
        address configuration, 
        address timelockController
    ) {
        CollateralToken[] tokens = new CollateralToken[](tokenAddresses.length);
        for (uint i = 0; i < tokenAddresses.length; i++) {
            tokens[i] = CollateralToken(
                tokenAddresses[i], 
                tokenQuantities[i], 
                tokenRateLimits[i]
            );
        }

        // Deploy static configuration
        Configuration c = new Configuration(
            tokens,
            rsrDepositDelaySeconds,
            rsrWithdrawalDelaySeconds,
            maxSupply,
            supplyExpansionRateScaled,
            revenueBatchSizeScaled,
            expenditureFactorScaled,
            spreadScaled, 
            issuanceBlockLimit,
            freezeTradingCost,
            rsrSellRate,
            rsrTokenAddress,
            circuitBreakerAddress,
            txFeeAddress,
            insurancePoolAddress,
            protocolFundAddress,
            exchangeAddress
        );

        address govAddress = owner;
        if (timelockGovernance) {
            // Launch TimelockController with initial delay of 0s
            address[] memory controllers = new address[](1);
            controllers[0] = owner;
            TimelockController tc = new TimelockController(0, controllers, controllers);
            govAddress = address(tc);
        }

        // Create RToken and InsurancePool
        RToken rtoken = new RToken(govAddress, name, symbol, address(c));
        InsurancePool ip = new InsurancePool(address(rtoken), c.rsrTokenAddress());
        return (address(rtoken), address(ip), address(c), govAddress);
    }
}
