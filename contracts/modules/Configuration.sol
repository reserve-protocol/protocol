// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "../external/zeppelin/access/Ownable.sol";
import "../interfaces/IConfiguration.sol";
import "../RToken.sol";

struct ConfigurationParams {

    /// RSR staking deposit delay (s)
    /// e.g. 2_592_000 => Newly staked RSR tokens take 1 month to enter the insurance pool
    uint256 stakingDepositDelay;

    /// RSR staking withdrawal delay (s)
    /// e.g. 2_592_000 => Currently staking RSR tokens take 1 month to withdraw
    uint256 stakingWithdrawalDelay;

    /// RToken max supply
    /// e.g. 1_000_000e18 => 1M max supply
    uint256 maxSupply;

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

    /// Addresses
    address circuitBreaker;
    address txFeeCalculator;
    address insurancePool;
    address protocolFund;
    address exchange;
}

/*
 * @title Configuration 
 * @dev This contract holds everything configurable by governance about the RToken. 
 */ 
contract Configuration is IConfiguration, Ownable {

    // ==== Public ====

    uint256 public constant override SCALE = 1e18;
    /// Used to express proportions relative to a constant. 
    /// 5% => 5e16

    uint256 public override immutable deployedAt;

    Token public override insuranceToken;

    // ==== Private ====

    Basket private _basket;
    ConfigurationParams private _params;

    constructor(
        Token[] memory tokens_,
        Token memory insuranceToken_,
        ConfigurationParams memory params_
    ) {
        deployedAt = block.timestamp;
        _basket.size = tokens_.length;
        for (uint256 i = 0; i < _basket.size; i++) {
            _basket.tokens[i] = tokens_[i];
        }
        _params = params_;
    }

    // ======================= Getters =========================

    // Structs

    function getBasketSize() external view override returns (uint256) {
        return _basket.size;
    }

    function getBasketTokenAdjusted(
        uint256 i
    ) external view override returns(address, uint256, uint256, uint256, uint256) { 
        uint256 rate = SCALE + _params.supplyExpansionRate * (block.timestamp - deployedAt) / 31536000;
        Token storage t = _basket.tokens[i];
        return (t.tokenAddress, t.quantity * SCALE / rate, t.rateLimit, t.priceInRToken, t.slippageTolerance);
    }

    function insuranceTokenAddress() external view override returns (address) {
        return insuranceToken.tokenAddress;
    }

    // Params

    function stakingDepositDelay() external view override returns (uint256) {
        return _params.stakingDepositDelay;
    }

    function stakingWithdrawalDelay() external view override returns (uint256) {
        return _params.stakingWithdrawalDelay;
    }

    function maxSupply() external view override returns (uint256) {
        return _params.maxSupply;
    }

    function supplyExpansionRate() external view override returns (uint256) {
        return _params.supplyExpansionRate;
    }

    function revenueBatchSize() external view override returns (uint256) {
        return _params.revenueBatchSize;
    }

    function expenditureFactor() external view override returns (uint256) {
        return _params.expenditureFactor;
    }

    function spread() external view override returns (uint256) {
        return _params.spread;
    }

    function issuanceRate() external view override returns (uint256) {
        return _params.issuanceRate;
    }

    function tradingFreezeCost() external view override returns (uint256) {
        return _params.tradingFreezeCost;
    }

    function circuitBreaker() external view override returns (address) {
        return _params.circuitBreaker;
    }

    function txFeeCalculator() external view override returns (address) {
        return _params.txFeeCalculator;
    }

    function insurancePool() external view override returns (address) {
        return _params.insurancePool;
    }

    function protocolFund() external view override returns (address) {
        return _params.protocolFund;
    }

    function exchange() external view override returns (address) {
        return _params.exchange;
    }

    // ==================== Setters ========================

    // Structs

    function setBasketTokenRateLimit(uint256 i, uint256 newLimit) external override onlyOwner {
        emit UIntConfigurationUpdated(
            "_basket.tokens.rateLimit", 
            _basket.tokens[i].rateLimit, 
            newLimit
        );
        _basket.tokens[i].rateLimit = newLimit;
    }

    function setBasketTokenPriceInRToken(uint256 i, uint256 price) external override onlyOwner {
        emit UIntConfigurationUpdated(
            "_basket.tokens.rateLimit", 
            _basket.tokens[i].priceInRToken, 
            price
        );
        _basket.tokens[i].priceInRToken = price;
    }

    function setInsuranceTokenRateLimit(uint256 newLimit) external override onlyOwner {
        emit UIntConfigurationUpdated("insuranceToken.rateLimit", insuranceToken.rateLimit, newLimit);
        insuranceToken.rateLimit = newLimit;
    }

    function setInsuranceTokenPriceInRToken(uint256 newPrice) external override onlyOwner {
        emit UIntConfigurationUpdated("insuranceToken.priceInRToken", insuranceToken.priceInRToken, newPrice);
        insuranceToken.priceInRToken = newPrice;
    }

    // Params

    function setStakingDepositDelay(uint256 newDelay) external override onlyOwner {
        emit UIntConfigurationUpdated("stakingDepositDelay", _params.stakingDepositDelay, newDelay);
        _params.stakingDepositDelay = newDelay;
    }

    function setStakingWithdrawalDelay(uint256 newDelay) external override onlyOwner {
        emit UIntConfigurationUpdated("stakingWithdrawalDelay", _params.stakingWithdrawalDelay, newDelay);
        _params.stakingWithdrawalDelay = newDelay;
    }

    function setMaxSupply(uint256 newSupply) external override onlyOwner {
        emit UIntConfigurationUpdated("maxSupply", _params.maxSupply, newSupply);
        _params.maxSupply = newSupply;
    }

    function setSupplyExpansionRate(uint256 newRate) external override onlyOwner {
        emit UIntConfigurationUpdated("supplyExpansionRate", _params.supplyExpansionRate, newRate);
        _params.supplyExpansionRate = newRate;
    }

    function setRevenueBatchSize(uint256 newSize) external override onlyOwner {
        emit UIntConfigurationUpdated("revenueBatchSize", _params.revenueBatchSize, newSize);
        _params.revenueBatchSize = newSize;
    }

    function setExpenditureFactor(uint256 newFactor) external override onlyOwner {
        emit UIntConfigurationUpdated("expenditureFactor", _params.expenditureFactor, newFactor);
        _params.expenditureFactor = newFactor;
    }

    function setSpread(uint256 newSpread) external override onlyOwner {
        emit UIntConfigurationUpdated("spread", _params.spread, newSpread);
        _params.spread = newSpread;
    }

    function setIssuanceRate(uint256 newRate) external override onlyOwner {
        emit UIntConfigurationUpdated("issuanceRate", _params.issuanceRate, newRate);
        _params.issuanceRate = newRate;
    }

    function setTradingFreezeCost(uint256 newCost) external override onlyOwner {
        emit UIntConfigurationUpdated("tradingFreezeCost", _params.tradingFreezeCost, newCost);
        _params.tradingFreezeCost = newCost;
    }

    function setCircuitBreaker(address newCircuitBreaker) external override onlyOwner {
        emit AddressConfigurationUpdated("circuitBreaker", _params.circuitBreaker, newCircuitBreaker);
        _params.circuitBreaker = newCircuitBreaker;
    }

    function setTxFeeCalculator(address newCalculator) external override onlyOwner {
        emit AddressConfigurationUpdated("txFeeCalculator", _params.txFeeCalculator, newCalculator);
        _params.txFeeCalculator = newCalculator;
    }

    function setInsurancePool(address newPool) external override onlyOwner {
        emit AddressConfigurationUpdated("insurancePool", _params.insurancePool, newPool);
        _params.insurancePool = newPool;
    }

    function setProtocolFund(address newFund) external override onlyOwner {
        emit AddressConfigurationUpdated("protocolFund", _params.protocolFund, newFund);
        _params.protocolFund = newFund;
    }

    function setExchange(address newExchange) external override onlyOwner {
        emit AddressConfigurationUpdated("exchange", _params.exchange, newExchange);
        _params.exchange = newExchange;
    }
}
