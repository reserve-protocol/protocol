// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "./interfaces/IConfiguration.sol";
import "./RToken.sol";

/*
 * @title Configuration 
 * @dev This contract holds everything configurable by governance about the RToken. 
 * It is immutable once deployed, offering "read-only" functionality.
 */ 
contract Configuration is IConfiguration {

    CollateralToken[] public basket;

    /// "*scaled" vars are relative to SCALE.
    uint256 public constant SCALE = 1e18;
    /// For example, a 5% interest rate would be 5e16.

    /// RSR staking deposit delay (s)
    /// e.g. 2_592_000 => Newly staked RSR tokens take 1 month to earn the right to vote.
    /// TODO: usage not implemented
    uint32 public immutable rsrDepositDelaySeconds;

    /// RSR staking withdrawal delay (s)
    /// e.g. 2_592_000 => Currently staking RSR tokens take 1 month to withdraw
    uint32 public immutable rsrWithdrawalDelaySeconds;

    /// RToken max supply
    /// e.g. 1_000_000e18 => 1M max supply
    uint256 public immutable maxSupply;

    /// RToken annual supply-expansion rate, scaled
    /// e.g. 1.23e16 => 1.23% annually
    uint256 public immutable supplyExpansionRateScaled;

    /// RToken revenue batch sizes
    /// e.g. 1e15 => 0.1% of the RToken supply
    uint256 public immutable revenueBatchSizeScaled;

    /// Protocol expenditure factor
    /// e.g. 1e16 => 1% of the RToken supply expansion goes to expenditures
    uint256 public immutable expenditureFactorScaled;

    /// Issuance/Redemption spread
    /// e.g. 1e14 => 0.01% spread
    uint256 public immutable spreadScaled; 

    /// RToken issuance blocklimit
    /// e.g. 25_000e18 => 25_000e18 (atto)RToken can be issued per block
    uint256 public immutable issuanceBlockLimit;

    /// Cost of freezing trading (in RSR)
    /// e.g. 100_000_000e18 => 100M RSR
    uint256 public immutable tradingFreezeCost;

    /// RSR sell rate per block (in RSR) 
    /// e.g. 1_000_000e18 => 1M RSR per block
    uint256 public immutable rsrSellRate;

    /// Addresses
    address public immutable rsrTokenAddress;
    address public immutable circuitBreakerAddress;
    address public immutable txFeeAddress;
    address public immutable insurancePoolAddress;
    address public immutable batchAuctionAddress;
    address public immutable protocolFundAddress;
    address public immutable exchangeAddress;


    /// Generated
    uint256 public immutable initializedTimestamp;

    constructor(
        CollateralToken[] memory basket_,
        uint32 rsrDepositDelaySeconds_,
        uint32 rsrWithdrawalDelaySeconds_,
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
        address batchAuctionAddress_,
        address protocolFundAddress_,
        address exchangeAddress_
    ) {
        basket = basket_;
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
        batchAuctionAddress = batchAuctionAddress_;
        protocolFundAddress = protocolFundAddress_;
        exchangeAddress = exchangeAddress_;

        initializedTimestamp = block.timestamp;
    }

    function getBasketForCurrentBlock() external view returns(CollateralToken[] memory) { 
        CollateralToken[] memory newBasket = new CollateralToken[](basket.length);
        uint256 scaledRate = SCALE + supplyExpansionRateScaled * (block.timestamp - initializedTimestamp) / 31536000;
        for (uint32 i = 0; i < basket.length; i++) {
            newBasket[i] = CollateralToken(
                basket[i].tokenAddress,
                basket[i].quantity * SCALE / scaledRate,
                basket[i].perBlockRateLimit
            );
        }
        return newBasket;
    }
}
