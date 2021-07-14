// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

interface IRToken {

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

        /// Contract Addresses
        address circuitBreaker;
        address txFeeCalculator;
        address insurancePool;
        address protocolFund;
        address exchange;
    }

    /// Only callable by Owner.
    function updateConfig(Config memory newConfig) external;

    /// Adaptation function, callable by anyone
    function act() external;

    /// Handles issuance.
    /// Requires approvals to be in place beforehand.
    function issue(uint256 amount) external;

    /// Handles redemption.
    function redeem(uint256 amount) external;

    /// Global trading freeze, callable by anyone
    function freezeTrading() external;

    function unfreezeTrading() external;

    function setBasketTokenPriceInRToken(uint16 i, uint256 priceInRToken) external;

    function setRSRPriceInRToken(uint256 priceInRToken) external;

    /// =========================== Views =================================

    function basketSize() external view returns (uint16);

    function stakingDepositDelay() external view returns (uint256);

    function stakingWithdrawalDelay() external view returns (uint256);

    function insurancePool() external view returns (address);
    
    function tradingFrozen() external view returns (bool);

    /// Returns the amounts of collateral tokens required to issue `amount` quantity
    function issueAmounts(uint256 amount) external view returns (uint256[] memory);

    /// Returns the amounts of collateral tokens to be paid during a redemption
    function redemptionAmounts(uint256 amount) external view returns (uint256[] memory);

    function calculateFee(
        address from,
        address to,
        uint256 amount
    ) external view returns (uint256);

    event ConfigUpdated(); // this feels weird
    event SlowMintingInitiated(address account, uint256 amount);
    event SlowMintingComplete(address account, uint256 amount);
    event Redemption(address indexed redeemer, uint256 indexed amount);
    event TradingFrozen(address indexed account);
    event TradingUnfrozen(address indexed account);

}
