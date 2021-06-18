// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

interface IConfiguration {

    function getBasketSize() external view returns (uint256);
    function getBasketTokenAdjusted(uint256 index) external view returns(address, uint256, uint256);

    function SCALE() external view returns (uint256);
    function rsrDepositDelaySeconds() external view returns (uint256);
    function rsrWithdrawalDelaySeconds() external view returns (uint256);
    function maxSupply() external view returns (uint256);
    function supplyExpansionRateScaled() external view returns (uint256);
    function revenueBatchSizeScaled() external view returns (uint256);
    function expenditureFactorScaled() external view returns (uint256);
    function spreadScaled() external view returns (uint256);
    function issuanceBlockLimit() external view returns (uint256);
    function tradingFreezeCost() external view returns (uint256);
    function rsrSellRate() external view returns (uint256);
    function rsrTokenAddress() external view returns (address);
    function circuitBreakerAddress() external view returns (address);
    function txFeeAddress() external view returns (address);
    function insurancePoolAddress() external view returns (address);
    function batchAuctionAddress() external view returns (address);
    function protocolFundAddress() external view returns (address);
    function exchangeAddress() external view returns (address);
    function initializedTimestamp() external view returns (uint256);
}


