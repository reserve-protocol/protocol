// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

interface IConfiguration {

    // Getters
    function getBasketSize() external view returns (uint256);
    function getBasketTokenAdjusted(uint256 index) external view returns(address, uint256, uint256);

    function SCALE() external view returns (uint256);
    function stakingDepositDelay() external view returns (uint256);
    function stakingWithdrawalDelay() external view returns (uint256);
    function maxSupply() external view returns (uint256);
    function supplyExpansionRate() external view returns (uint256);
    function revenueBatchSize() external view returns (uint256);
    function expenditureFactor() external view returns (uint256);
    function spread() external view returns (uint256);
    function issuanceRate() external view returns (uint256);
    function tradingFreezeCost() external view returns (uint256);
    function circuitBreaker() external view returns (address);
    function txFee() external view returns (address);
    function insurancePool() external view returns (address);
    function protocolFund() external view returns (address);
    function exchange() external view returns (address);
    function deployedAt() external view returns (uint256);


    // Setters
    function setBasketTokenRateLimit(uint256 i, uint256 newLimit) external;
    function setInsuranceTokenRateLimit(uint256 newLimit) external;
    
    function setStakingDepositDelay(uint256 newDelay) external;
    function setStakingWithdrawalDelay(uint256 newDelay) external;
    function setMaxSupply(uint256 newSupply) external;
    function setSupplyExpansionRate(uint256 newRate) external;
    function setRevenueBatchSize(uint256 newSize) external;
    function setExpenditureFactor(uint256 newFactor) external;
    function setSpread(uint256 newSpread) external;
    function setIssuanceRate(uint256 newRate) external;
    function setTradingFreezeCost(uint256 newCost) external;
    function setCircuitBreaker(address newCircuitBreaker) external;
    function setTxFeeCalculator(address newCalculator) external;
    function setInsurancePool(address newPool) external;
    function setProtocolFund(address newFund) external;
    function setExchange(address newExchange) external;

    // Events
    event ConfigurationUpdated(string variable, uint256 oldVal, uint256 newVal);   
}


