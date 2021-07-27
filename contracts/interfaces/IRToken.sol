// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "../interfaces/ICircuitBreaker.sol";
import "../libraries/Token.sol";
import "../RToken.sol";

interface IRToken {
    /// Only callable by Owner.
    function updateConfig(RToken.Config memory newConfig) external;

    /// Only callable by Owner.
    function updateBasket(Token.Info[] memory tokens) external;

    /// callable by anyone: rebalancing, slow minting, supply expansion, and basket decay
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
    event BasketUpdated(uint16 oldSize, uint16 newSize);
    event SlowMintingInitiated(address account, uint256 amount);
    event SlowMintingComplete(address account, uint256 amount);
    event Redemption(address indexed redeemer, uint256 indexed amount);
    event TradingFrozen(address indexed account);
    event TradingUnfrozen(address indexed account);
}
