// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "../zeppelin/access/Ownable.sol";
import "../interfaces/IConfiguration.sol";
import "../RToken.sol";

/*
 * @title Configuration 
 * @dev This contract holds everything configurable by governance about the RToken. 
 */ 
contract Configuration is IConfiguration, Ownable {

    /// "*scaled" vars are relative to SCALE.
    uint256 public constant override SCALE = 1e18;
    /// For example, a 5% interest rate would be 5e16.

    // ========= Immutable ==========

    /// Generated
    uint256 public override immutable deployedAt;

    Basket public immutable basket;

    /// Definition of insurance token address + block rates
    Token public immutable insuranceToken;

    // ========= Mutable ==========

    /// RSR staking deposit delay (s)
    /// e.g. 2_592_000 => Newly staked RSR tokens take 1 month to earn the right to vote.
    /// TODO: usage not implemented
    uint256 public override stakingDepositDelay;

    /// RSR staking withdrawal delay (s)
    /// e.g. 2_592_000 => Currently staking RSR tokens take 1 month to withdraw
    uint256 public override stakingWithdrawalDelay;

    /// RToken max supply
    /// e.g. 1_000_000e18 => 1M max supply
    uint256 public override maxSupply;

    /// RToken annual supply-expansion rate, scaled
    /// e.g. 1.23e16 => 1.23% annually
    uint256 public override supplyExpansionRate;

    /// RToken revenue batch sizes
    /// e.g. 1e15 => 0.1% of the RToken supply
    uint256 public override revenueBatchSize;

    /// Protocol expenditure factor
    /// e.g. 1e16 => 1% of the RToken supply expansion goes to expenditures
    uint256 public override expenditureFactor;

    /// Issuance/Redemption spread
    /// e.g. 1e14 => 0.01% spread
    uint256 public override spread; 

    /// RToken issuance blocklimit
    /// e.g. 25_000e18 => 25_000e18 (atto)RToken can be issued per block
    uint256 public override issuanceRate;

    /// Cost of freezing trading (in RSR)
    /// e.g. 100_000_000e18 => 100M RSR
    uint256 public override tradingFreezeCost;

    /// Addresses
    address public override circuitBreaker;
    address public override txFeeCalculator;
    address public override insurancePool;
    address public override protocolFund;
    address public override exchange;

    constructor(
        Token[] memory tokens_,
        Token memory rsr_,
        uint256 stakingDepositDelay_,
        uint256 stakingWithdrawalDelay_,
        uint256 maxSupply_,
        uint256 supplyExpansionRate_,
        uint256 revenueBatchSize_,
        uint256 expenditureFactor_,
        uint256 spread_, 
        uint256 issuanceRate_,
        uint256 tradingFreezeCost_,
        address circuitBreaker_,
        address txFeeCalculator_,
        address insurancePool_,
        address protocolFund_,
        address exchange_
    ) {
        deployedAt = block.timestamp;
        basket.size = tokens_.length;
        for (uint256 i = 0; i < basket.size; i++) {
            basket.tokens[i] = tokens_[i];
        }
        insuranceToken = rsr_;
        stakingDepositDelay = stakingDepositDelay_;
        stakingWithdrawalDelay = stakingWithdrawalDelay_;
        maxSupply = maxSupply_;
        supplyExpansionRate = supplyExpansionRate_;
        revenueBatchSize = revenueBatchSize_;
        expenditureFactor = expenditureFactor_;
        spread = spread_;
        issuanceRate = issuanceRate_;
        tradingFreezeCost = tradingFreezeCost_;
        rsrSellRate = rsrSellRate_;
        rsrToken = rsrToken_;
        circuitBreaker = circuitBreaker_;
        txFeeCalculator = txFeeCalculator_;
        insurancePool = insurancePool_;
        protocolFund = protocolFund_;
        exchange = exchange_;
    }

    function getBasketSize() external view override returns (uint256) {
        return basket.size;
    }

    function getBasketTokenAdjusted(uint256 i) external view override returns(address, uint256, uint256) { 
        uint256 rate = SCALE + supplyExpansionRate * (block.timestamp - deployedAt) / 31536000;
        Token storage ct = basket.tokens[i];
        return (ct.token, ct.quantity * SCALE / rate, ct.rateLimit);
    }

    // ==================== Setters ========================

    function setBasketTokenRateLimit(uint256 i, uint256 newLimit) external override onlyOwner {
        emit ConfigurationUpdated(
            "basket.tokens[" + i + "].rateLimit", 
            basket.tokens[i].rateLimit, 
            newLimit
        );
        basket.tokens[i].rateLimit = newLimit;
    }

    function setInsuranceTokenRateLimit(uint256 newLimit) external override onlyOwner {
        emit ConfigurationUpdated("insuranceToken.rateLimit", insuranceToken.rateLimit, newLimit);
        insuranceToken.rateLimit = newLimit;
    }

    // Simple vars

    function setStakingDepositDelay(uint256 newDelay) external override onlyOwner {
        emit ConfigurationUpdated("stakingDepositDelay", stakingDepositDelay, newDelay);
        stakingDepositDelay = newDelay;
    }

    function setStakingWithdrawalDelay(uint256 newDelay) external override onlyOwner {
        emit ConfigurationUpdated("stakingWithdrawalDelay", stakingWithdrawalDelay, newDelay);
        stakingWithdrawalDelay = newDelay;
    }

    function setMaxSupply(uint256 newSupply) external override onlyOwner {
        emit ConfigurationUpdated("maxSupply", maxSupply, newSupply);
        maxSupply = newSupply;
    }

    function setSupplyExpansionRate(uint256 newRate) external override onlyOwner {
        emit ConfigurationUpdated("supplyExpansionRate", supplyExpansionRate, newRate);
        supplyExpansionRate = newRate;
    }

    function setRevenueBatchSize(uint256 newSize) external override onlyOwner {
        emit ConfigurationUpdated("revenueBatchSize", revenueBatchSize, newSize);
        revenueBatchSize = newSupply;
    }

    function setExpenditureFactor(uint256 newFactor) external override onlyOwner {
        emit ConfigurationUpdated("expenditureFactor", expenditureFactor, newFactor);
        expenditureFactor = newFactor;
    }

    function setSpread(uint256 newSpread) external override onlyOwner {
        emit ConfigurationUpdated("spread", spread, newSpread);
        spread = newSpread;
    }

    function setIssuanceRate(uint256 newRate) external override onlyOwner {
        emit ConfigurationUpdated("issuanceRate", issuanceRate, newRate);
        issuanceRate = newRate;
    }

    function setTradingFreezeCost(uint256 newCost) external override onlyOwner {
        emit ConfigurationUpdated("tradingFreezeCost", tradingFreezeCost, newCost);
        tradingFreezeCost = newCost;
    }


    // Addresses/contracts

    function setCircuitBreaker(address newCircuitBreaker) external override onlyOwner {
        emit ConfigurationUpdated("circuitBreaker", circuitBreaker, newCircuitBreaker);
        circuitBreaker = newCircuitBreaker;
    }

    function setTxFeeCalculator(address newCalculator) external override onlyOwner {
        emit ConfigurationUpdated("txFeeCalculator", txFeeCalculator, newCalculator);
        txFeeCalculator = newCalculator;
    }

    function setInsurancePool(address newPool) external override onlyOwner {
        emit ConfigurationUpdated("insurancePool", insurancePool, newPool);
        insurancePool = newPool;
    }

    function setProtocolFund(address newFund) external override onlyOwner {
        emit ConfigurationUpdated("protocolFund", protocolFund, newFund);
        protocolFund = newFund;
    }

    function setExchange(address newExchange) external override onlyOwner {
        emit ConfigurationUpdated("exchange", exchange, newExchange);
        exchange = newExchange;
    }
}
