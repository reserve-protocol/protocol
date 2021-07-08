// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

struct Token {
    address tokenAddress;

    // How many tokens for each 1e18 RTokens
    uint256 quantity;

    // How many tokens to sell per each block
    uint256 rateLimit;

    // Quantity of Token that is equal in value to 1e18 RTokens (always a little stale)
    uint256 priceInRToken;

    // A number <=1e18 that indicates how much price movement to allow.
    // E.g., 5e17 means up to a 50% price movement before the RToken halts trading.
    // The slippage for a pair is the combination of two `slippageTolerance`
    uint256 slippageTolerance;
}

struct Basket {
    mapping(uint16 => Token) tokens;
    uint16 size;
}


struct AppStorage {
    Token insuranceToken;
    Basket basket;

    /// Relay data
    mapping(address => uint256) metaNonces;

    /// Addresses
    address circuitBreaker;
    address txFeeCalculator;
    address insurancePool;
    address protocolFund;
    address exchange;

    /// ==== Global Params ====

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
}


library AppConfiguration {

    event BasketUpdated(uint16 indexed index, string indexed var, uint256 oldVal, uint256 newVal);
    event UIntUpdated(string indexed var, uint256 oldVal, address newVal);
    event AddressUpdated(string indexed var, address oldVal, address newVal);

    function setBasketTokenRateLimit(AppStorage storage s, uint16 i, uint256 newLimit) internal {
        emit BasketUpdated(
            i,
            "rateLimit",
            s.basket.tokens[i].rateLimit,
            newLimit
        );
        s.basket.tokens[i].rateLimit = newLimit;
    }

    function setBasketTokenPriceInRToken(AppStorage storage s, uint16 i, uint256 price) internal {
        emit BasketUpdated(
            i,
            "priceInRToken",
            s.basket.tokens[i].priceInRToken,
            price
        );
        s.basket.tokens[i].priceInRToken = price;
    }

    function setInsuranceTokenRateLimit(AppStorage storage s, uint256 newLimit) internal {
        emit UIntUpdated(
            "insuranceToken.rateLimit",
            insuranceToken.rateLimit,
            newLimit
        );
        s.insuranceToken.rateLimit = newLimit;
    }

    function setInsuranceTokenPriceInRToken(AppStorage storage s, uint256 newPrice) internal {
        emit UIntUpdated(
            "insuranceToken.priceInRToken",
            insuranceToken.priceInRToken,
            newPrice
        );
        s.insuranceToken.priceInRToken = newPrice;
    }

    function setStakingDepositDelay(AppStorage storage s, uint256 newDelay) internal {
        emit UIntUpdated("stakingDepositDelay", s.stakingDepositDelay, newDelay);
        s.stakingDepositDelay = newDelay;
    }

    function setStakingWithdrawalDelay(AppStorage storage s, uint256 newDelay) internal {
        emit UIntUpdated(
            "stakingWithdrawalDelay",
            s.stakingWithdrawalDelay,
            newDelay
        );
        s.stakingWithdrawalDelay = newDelay;
    }

    function setMaxSupply(AppStorage storage s, uint256 newSupply) internal {
        emit UIntUpdated("maxSupply", s.maxSupply, newSupply);
        s.maxSupply = newSupply;
    }

    function setSupplyExpansionRate(AppStorage storage s, uint256 newRate) internal {
        emit UIntUpdated("supplyExpansionRate", s.supplyExpansionRate, newRate);
        s.supplyExpansionRate = newRate;
    }

    function setRevenueBatchSize(AppStorage storage s, uint256 newSize) internal {
        emit UIntUpdated("revenueBatchSize", s.revenueBatchSize, newSize);
        s.revenueBatchSize = newSize;
    }

    function setExpenditureFactor(AppStorage storage s, uint256 newFactor) internal {
        emit UIntUpdated("expenditureFactor", s.expenditureFactor, newFactor);
        s.expenditureFactor = newFactor;
    }

    function setSpread(AppStorage storage s, uint256 newSpread) internal {
        emit UIntUpdated("spread", s.spread, newSpread);
        s.spread = newSpread;
    }

    function setIssuanceRate(AppStorage storage s, uint256 newRate) internal {
        emit UIntUpdated("issuanceRate", s.issuanceRate, newRate);
        s.issuanceRate = newRate;
    }

    function setTradingFreezeCost(AppStorage storage s, uint256 newCost) internal {
        emit UIntUpdated("tradingFreezeCost", s.tradingFreezeCost, newCost);
        s.tradingFreezeCost = newCost;
    }

    function setCircuitBreaker(AppStorage storage s, address newCircuitBreaker) internal {
        emit AddressUpdated(
            "circuitBreaker",
            s.circuitBreaker,
            newCircuitBreaker
        );
        s.circuitBreaker = newCircuitBreaker;
    }

    function setTxFeeCalculator(AppStorage storage s, address newCalculator) internal {
        emit AddressUpdated("txFeeCalculator", s.txFeeCalculator, newCalculator);
        s.txFeeCalculator = newCalculator;
    }

    function setInsurancePool(AppStorage storage s, address newPool) internal {
        emit AddressUpdated("insurancePool", s.insurancePool, newPool);
        s.insurancePool = newPool;
    }

    function setProtocolFund(AppStorage storage s, address newFund) internal {
        emit AddressUpdated("protocolFund", s.protocolFund, newFund);
        s.protocolFund = newFund;
    }

    function setExchange(AppStorage storage s, address newExchange) internal {
        emit AddressUpdated("exchange", s.exchange, newExchange);
        s.exchange = newExchange;
    }
}
