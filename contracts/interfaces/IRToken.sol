// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "../interfaces/ICircuitBreaker.sol";
import "../interfaces/IAtomicExchange.sol";
import "../interfaces/ITXFee.sol";
import "../interfaces/IInsurancePool.sol";
import "../libraries/Token.sol";

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
        /// Minimum minting amount
        /// e.g. 1_000e18 => 1k RToken
        uint256 minMintingSize;
        /// RToken issuance blocklimit
        /// e.g. 25_000e18 => 25_000e18 (atto)RToken can be issued per block
        uint256 issuanceRate;
        /// Cost of freezing rebalancing (in RSR)
        /// e.g. 100_000_000e18 => 100M RSR
        uint256 rebalancingFreezeCost;
        /// Percentage rates are relative to 1e18, the constant SCALE variable set in RToken.

        /// Frequency with which RToken sweeps supply expansion revenue into the insurance pool (s)
        /// This must be relatively infrequent.
        /// e.g. 1 week = 60 * 60 * 24 * 7 = 604800
        uint256 insurancePaymentPeriod;
        /// RToken per-second supply-expansion rate
        /// e.g. 3% annually => 0.0000000936681155% per-second => 0.000000000936681155 * 1e18 => 936681155
        uint256 expansionPerSecond;
        /// Protocol expenditure factor
        /// e.g. 1e16 => 1% of the RToken supply expansion goes to protocol fund
        uint256 expenditureFactor;
        /// Issuance/Redemption spread
        /// e.g. 1e14 => 0.01% spread
        uint256 spread;
        /// Modules
        IAtomicExchange exchange;
        ICircuitBreaker circuitBreaker;
        ITXFee txFeeCalculator;
        IInsurancePool insurancePool;
        /// Addresses
        address protocolFund;
    }

    /// Only callable by Owner.
    function updateConfig(Config memory newConfig) external;

    /// Only callable by Owner.
    function updateBasket(Token.Info[] memory tokens) external;

    /// callable by anyone: rebalancing, slow minting, supply expansion, and basket decay
    function act() external;

    /// Handles issuance.
    /// Requires approvals to be in place beforehand.
    function issue(uint256 amount) external;

    /// Handles redemption.
    function redeem(uint256 amount) external;

    /// Global rebalancing freeze, callable by anyone
    function freezeRebalancing() external;

    function unfreezeRebalancing() external;

    function setBasketTokenPriceInRToken(uint16 i, uint256 priceInRToken) external;

    function setRSRPriceInRToken(uint256 priceInRToken) external;

    /// =========================== Views =================================

    function basketSize() external view returns (uint16);

    function basketToken(uint16 i) external view returns (Token.Info memory);

    function stakingDepositDelay() external view returns (uint256);

    function stakingWithdrawalDelay() external view returns (uint256);

    function rsr() external view returns (Token.Info memory);

    function insurancePool() external view returns (address);

    function rebalancingFrozen() external view returns (bool);

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
    event BasketUpdated(uint16 oldSize, uint16 newSize);
    event SlowMintingInitiated(address account, uint256 amount);
    event SlowMintingComplete(address account, uint256 amount);
    event Redemption(address indexed redeemer, uint256 indexed amount);
    event RebalancingFrozen(address indexed account);
    event RebalancingUnfrozen(address indexed account);
    event MaxSupplyExceeded();
}
