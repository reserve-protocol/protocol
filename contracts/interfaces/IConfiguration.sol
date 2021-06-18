// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "../RToken.sol";

interface IConfiguration {

    function getBasketForCurrentBlock() external view returns(CollateralToken[] memory);

    function scale() external returns (uint256);
    function rsrDepositDelaySeconds() external returns (uint32);
    function rsrWithdrawalDelaySeconds() external returns (uint32);
    function maxSupply() external returns (uint256);
    function supplyExpansionRateScaled() external returns (uint256);
    function revenueBatchSizeScaled() external returns (uint256);
    function expenditureFactorScaled() external returns (uint256);
    function spreadScaled() external returns (uint256);
    function issuanceBlockLimit() external returns (uint256);
    function tradingFreezeCost() external returns (uint256);
    function rsrSellRate() external returns (uint256);
    function rsrTokenAddress() external returns (address);
    function circuitBreakerAddress() external returns (address);
    function txFeeAddress() external returns (address);
    function insurancePoolAddress() external returns (address);
    function batchAuctionAddress() external returns (address);
    function protocolFundAddress() external returns (address);
    function exchangeAddress() external returns (address);
    function initializedTimestamp() external returns (uint256);
}


