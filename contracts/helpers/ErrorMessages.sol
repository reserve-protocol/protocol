
// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

// RToken
error RebalancingIsFrozen();
error RebalancingAlreadyUnfrozen();
error BadSell();
error BadBuy();

// Minting
error MintingAmountTooLow();
error MintToZeroAddressNotAllowed();
error CannotMintZero();

// Configuration
error SlippageToleranceTooBig();
error SupplyExpansionTooLarge();
error SpreadTooLarge();
error RedeemAmountCannotBeZero();
error ExpenditureFactorTooLarge();
error MaxSupplyExceeded();

// Basket
error EmptyBasket();
error BasketTooBig();
error UninitializedTokens();
error InvalidTokenIndex();

// Circuit Breaker
error CircuitPaused();

// Authorization
error Unauthorized();
error OnlyRToken();

// Transfer/Rebalancing
error TransferToContractAddress();
error NotEnoughBalance();

// Insurance Pool
error CannotStakeZero();
error CannotWithdrawZero();

// RSR
error CrossedAlready();

