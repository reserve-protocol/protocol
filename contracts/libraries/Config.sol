// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "../interfaces/IAtomicExchange.sol";
import "../interfaces/ICircuitBreaker.sol";
import "../interfaces/ITXFee.sol";
import "../interfaces/IInsurancePool.sol";

struct Config {

    /// RSR staking deposit delay (s)
    /// e.g. 2_592_000 => Newly staked RSR tokens take 1 month to enter the insurance pool
    uint256 stakingDepositDelay;
    /// RSR staking withdrawal delay (s)
    /// e.g. 2_592_000 => Currently staking RSR tokens take 1 month to withdraw
    uint256 stakingWithdrawalDelay;
    /// RToken max supply
    /// e.g. 1_000_000e18 => 1M max supply
    uint256 maxSupply;

    /// Percentage rates are relative to 1e18, the constant SCALE variable set in RToken.

    /// Minimum minting amount
    /// e.g. 1_000e18 => 1k RToken 
    uint256 minMintingSize;
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

    /// Modules
    IAtomicExchange exchange;
    ICircuitBreaker circuitBreaker;
    ITXFee txFeeCalculator;
    IInsurancePool insurancePool;

    /// Addresses
    address protocolFund;
}
