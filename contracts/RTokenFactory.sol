// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "./interfaces/IConfiguration.sol";
import "./zeppelin/governance/TimelockController.sol";
import "./modules/SimpleOrderbookExchange.sol";
import "./modules/InsurancePool.sol";
import "./modules/Configuration.sol";
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
        uint256[] memory tokenPricesInRToken, 
        uint256[] memory tokenSlippageTolerances, 
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
        address rsrTokenAddress,
        uint256 rsrSellRate,
        uint256 rsrPriceInRToken,
        uint256 rsrSlippageTolerance,
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
        Token[] memory tokens = new Token[](tokenAddresses.length);
        for (uint i = 0; i < tokenAddresses.length; i++) {
            tokens[i] = Token(
                tokenAddresses[i], 
                tokenQuantities[i], 
                tokenRateLimits[i],
                tokenPricesInRToken[i],
                tokenSlippageTolerances[i]
            );
        }

        Token memory insuranceToken = Token(
                rsrTokenAddress, 
                0, 
                rsrSellRate,
                rsrPriceInRToken,
                rsrSlippageTolerance);

        ConfigurationParams memory configParams = ConfigurationParams(
                rsrDepositDelaySeconds,
                rsrWithdrawalDelaySeconds,
                maxSupply,
                supplyExpansionRateScaled,
                revenueBatchSizeScaled,
                expenditureFactorScaled,
                spreadScaled, 
                issuanceBlockLimit,
                freezeTradingCost,
                circuitBreakerAddress,
                txFeeAddress,
                insurancePoolAddress,
                protocolFundAddress,
                exchangeAddress);

        // Deploy static configuration
        Configuration c = new Configuration(
            tokens,
            insuranceToken,
            configParams
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
        (address rsrAddress,,,,) = c.insuranceToken();   
        InsurancePool ip = new InsurancePool(address(rtoken), rsrAddress);
        return (address(rtoken), address(ip), address(c), govAddress);
    }
}
