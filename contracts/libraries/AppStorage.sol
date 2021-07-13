// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";

import "./Token.sol";

struct Basket {
    mapping(uint16 => Token) tokens;
    uint16 size;
}

struct Minting {
    uint256 amount;
    address account;
}

struct RevenueEvent {
   uint256 amount;
   uint256 totalStaked;
}

struct StakingEvent {
    address account;
    uint256 timestamp;
    uint256 amount;
}

struct AppStorage {

    // ============ Facet-specific =============

    // MetaTxFacet
    mapping(address => uint256) metaNonces;

    // SlowMintingFacet
    Minting[] mintings;
    uint256 currentMinting;
    address freezer;

    // CircuitBreaker
    bool tripped;

    // InsurancePool
    RevenueEvent[] revenueEvents;
    StakingEvent[] deposits;
    StakingEvent[] withdrawals;
    mapping(address => uint256) lastFloor;
    mapping(address => uint256) rTokenEarned;
    mapping(address => uint256) rsrStakeBalances;
    uint256 rsrStaked;
    uint256 depositIndex;
    uint256 withdrawalIndex;

    // ERC20
    mapping(address => uint256) balances;
    mapping(address => mapping(address => uint256)) allowances;
    uint256 totalSupply;
    string name;
    string symbol;

    // ============ Shared =============

    Basket basket;
    Token.Info rsr;

    /// RSR staking deposit delay (s)
    /// e.g. 2_592_000 => Newly staked RSR tokens take 1 month to enter the insurance pool
    uint256 stakingDepositDelay;
    /// RSR staking withdrawal delay (s)
    /// e.g. 2_592_000 => Currently staking RSR tokens take 1 month to withdraw
    uint256 stakingWithdrawalDelay;
    /// RToken max supply
    /// e.g. 1_000_000e18 => 1M max supply
    uint256 maxSupply;

    /// Percentage rates are relative to 1e18, a magic number that appears in our code.

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

    address protocolFund;
}
