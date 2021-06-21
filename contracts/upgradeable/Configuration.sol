// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "../interfaces/IConfiguration.sol";
import "../RToken.sol";

/*
 * @title Configuration 
 * @dev This contract holds everything configurable by governance about the RToken. 
 * It is immutable once deployed, offering "read-only" functionality.
 */ 
contract Configuration is IConfiguration {

    Basket public immutable basket;

    /// "*scaled" vars are relative to SCALE.
    uint256 public constant override SCALE = 1e18;
    /// For example, a 5% interest rate would be 5e16.

    /// RSR staking deposit delay (s)
    /// e.g. 2_592_000 => Newly staked RSR tokens take 1 month to earn the right to vote.
    /// TODO: usage not implemented
    uint256 public immutable override rsrDepositDelaySeconds;

    /// RSR staking withdrawal delay (s)
    /// e.g. 2_592_000 => Currently staking RSR tokens take 1 month to withdraw
    uint256 public immutable override rsrWithdrawalDelaySeconds;

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

    /// Addresses
    address public immutable override rsrTokenAddress;
    address public immutable override circuitBreakerAddress;
    address public immutable override txFeeAddress;
    address public immutable override insurancePoolAddress;
    address public immutable override protocolFundAddress;
    address public immutable override exchangeAddress;


    /// Generated
    uint256 public immutable override initializedTimestamp;

    constructor(
        CollateralToken[] memory tokens_,
        uint256 rsrDepositDelaySeconds_,
        uint256 rsrWithdrawalDelaySeconds_,
        uint256 maxSupply_,
        uint256 supplyExpansionRateScaled_,
        uint256 revenueBatchSizeScaled_,
        uint256 expenditureFactorScaled_,
        uint256 spreadScaled_, 
        uint256 issuanceBlockLimit_,
        uint256 tradingFreezeCost_,
        uint256 rsrSellRate_,
        address rsrTokenAddress_,
        address circuitBreakerAddress_,
        address txFeeAddress_,
        address insurancePoolAddress_,
        address protocolFundAddress_,
        address exchangeAddress_
    ) {
        basket.size = tokens_.length;
        for (uint256 i = 0; i < basket.size; i++) {
            basket.tokens[i] = tokens_[i];
        }
        rsrDepositDelaySeconds = rsrDepositDelaySeconds_;
        rsrWithdrawalDelaySeconds = rsrWithdrawalDelaySeconds_;
        maxSupply = maxSupply_;
        supplyExpansionRateScaled = supplyExpansionRateScaled_;
        revenueBatchSizeScaled = revenueBatchSizeScaled_;
        expenditureFactorScaled = expenditureFactorScaled_;
        spreadScaled = spreadScaled_;
        issuanceBlockLimit = issuanceBlockLimit_;
        tradingFreezeCost = tradingFreezeCost_;
        rsrSellRate = rsrSellRate_;
        rsrTokenAddress = rsrTokenAddress_;
        circuitBreakerAddress = circuitBreakerAddress_;
        txFeeAddress = txFeeAddress_;
        insurancePoolAddress = insurancePoolAddress_;
        protocolFundAddress = protocolFundAddress_;
        exchangeAddress = exchangeAddress_;

        initializedTimestamp = block.timestamp;
    }

    function getBasketSize() external view override returns (uint256) {
        return basket.size;
    }

    function getBasketTokenAdjusted(uint256 i) external view override returns(address, uint256, uint256) { 
        uint256 scaledRate = SCALE + supplyExpansionRateScaled * 
            (block.timestamp - initializedTimestamp) / 31536000;
        CollateralToken storage ct = basket.tokens[i];
        return (ct.tokenAddress, ct.quantity * SCALE / scaledRate, ct.perBlockRateLimit);
    }
}
