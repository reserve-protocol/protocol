pragma solidity 0.8.4;

import "../libraries/Basket.sol";

interface IConfiguration {

    /// RSR staking deposit delay (s)
    /// e.g. 2_592_000 => Newly staked RSR tokens take 1 month to earn the right to vote.
    /// TODO: usage not implemented
    uint32 public immutable override rsrDepositDelaySeconds;

    /// RSR staking withdrawal delay (s)
    /// e.g. 2_592_000 => Currently staking RSR tokens take 1 month to withdraw
    uint32 public immutable override rsrWithdrawalDelaySeconds;

    /// RToken max supply
    /// e.g. 1_000_000e18 => 1M max supply
    uint256 public immutable override maxSupply;

    /// RToken annual supply-expansion rate, scaled
    /// e.g. 1.23e16 => 1.23% annually
    uint256 public immutable override supplyExpansionRateScaled;

    /// RToken revenue batch sizes
    /// e.g. 1e15 => 0.1% of the RToken supply
    uint256 public immutable override revenueBatchSizeScaled;

    /// Protocol expenditure factor
    /// e.g. 1e16 => 1% of the RToken supply expansion goes to expenditures
    uint256 public immutable override expenditureFactorScaled;

    /// Issuance/Redemption spread
    /// e.g. 1e14 => 0.01% spread
    uint256 public immutable override spreadScaled; 

    /// RToken issuance blocklimit
    /// e.g. 25_000e18 => 25_000e18 (atto)RToken can be issued per block
    uint256 public immutable override issuanceBlockLimit;

    /// Cost of freezing trading (in RSR)
    /// e.g. 100_000_000e18 => 100M RSR
    uint256 public immutable override tradingFreezeCost;

    /// RSR sell rate per block (in RSR) 
    /// e.g. 1_000_000e18 => 1M RSR per block
    uint256 public immutable override rsrSellRate;

    /// RSR minimum rate of intake per block (in RSR) 
    /// e.g. 10_000e18 => 10k RSR per block
    uint256 public immutable override rsrMinBuyRate;

    /// Addresses
    address public immutable override rsrTokenAddress;
    address public immutable override circuitBreakerAddress;
    address public immutable override txFeeAddress;
    address public immutable override insurancePoolAddress;
    address public immutable override batchAuctionAddress;
    address public immutable override protocolFundAddress;
    address public immutable override exchangeAddress;

}


/*
 * @title Configuration 
 * @dev This contract holds everything configurable by governance about the RToken. 
 * It is immutable once deployed, offering "read-only" functionality.
 */ 
contract Configuration is IConfiguration {
    /// ==== Immutable Constants ====

    /// "*scaled" vars are relative to SCALE.
    uint256 public constant override SCALE = 1e18;
    /// For example, a 5% interest rate would be 5e16.

    Basket.Info public immutable override basket;

    constructor(
        Basket.Info calldata basket_,
        uint32 auctionLengthSeconds_,
        uint32 auctionSpacingSeconds_,
        uint32 rsrDepositDelaySeconds_,
        uint32 rsrWithdrawalDelaySeconds_,
        uint256 maxSupply_,
        uint256 supplyExpansionRateScaled_,
        uint256 revenueBatchSizeScaled_,
        uint256 expenditureFactorScaled_,
        uint256 spreadScaled_, 
        uint256 issuanceBlockLimit_,
        uint256 freezeTradingCost_,
        uint256 rsrSellRate_,
        uint256 rsrMinBuyRate_,
        address rsrTokenAddress_,
        address circuitBreakerAddress_,
        address txFeeAddress_,
        address insurancePoolAddress_,
        address batchAuctionAddress_,
        address protocolFundAddress_,
        address exchangeAddress_
    ) {
        basket = basket_;
        basket.timestampInitialized = block.timestamp;
        basket.update();

        auctionLengthSeconds = auctionLengthSeconds_;
        auctionSpacingSeconds = auctionSpacingSeconds_;
        rsrDepositDelaySeconds = rsrDepositDelaySeconds_;
        rsrWithdrawalDelaySeconds = rsrWithdrawalDelaySeconds_;
        maxSupply = maxSupply_;
        supplyExpansionRateScaled = supplyExpansionRateScaled_;
        revenueBatchSizeScaled = revenueBatchSizeScaled_;
        expenditureFactorScaled = expenditureFactorScaled_;
        spreadScaled = spreadScaled_;
        issuanceBlockLimit = issuanceBlockLimit_;
        freezeTradingCost = freezeTradingCost_;
        rsrSellRate = rsrSellRate_;
        rsrMinBuyRate = rsrMinBuyRate_;
        rsrTokenAddress = rsrTokenAddress_;
        circuitBreakerAddress = circuitBreakerAddress_;
        txFeeAddress = txFeeAddress_;
        insurancePoolAddress = insurancePoolAddress_;
        batchAuctionAddress = batchAuctionAddress_;
        protocolFundAddress = protocolFundAddress_;
        exchangeAddress = exchangeAddress_;
    }
}
