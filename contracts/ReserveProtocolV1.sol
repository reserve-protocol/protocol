// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "./deps/zeppelin/governance/TimelockController.sol";
import "./libraries/Basket.sol";
import "./rtoken/InsurancePool.sol";
import "./SimpleOrderbookExchange.sol";
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
        address owner,
        string calldata name, 
        string calldata symbol, 
        CollateralToken[] memory tokens, 
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
        address batchAuctionAddress,
        address protocolFundAddress
    ) public returns (
        address rToken, 
        address insurancePool, 
        address configuration, 
        address timelockController
    ) {
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
            batchAuctionAddress,
            protocolFundAddress,
            exchangeAddress
        );

        // Launch TimelockController with initial delay of 0s
        address[] memory controllers = new address[](1);
        controllers[0] = owner;
        TimelockController tc = new TimelockController(0, controllers, controllers);

        // Create RToken and InsurancePool
        RToken rtoken = new RToken(address(tc), name, symbol, address(c));
        InsurancePool ip = new InsurancePool(address(rtoken), c.rsrTokenAddress());
        return (address(rtoken), address(ip), address(c), address(tc));
    }
}
