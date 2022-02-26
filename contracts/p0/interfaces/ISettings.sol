// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/libraries/Fixed.sol";
import "./IComponent.sol";

interface ISettings is IComponent {
    event RewardStartSet(uint256 indexed oldVal, uint256 indexed newVal);

    function setRewardStart(uint256 rewardStart) external;

    function rewardStart() external view returns (uint256);

    event RewardPeriodSet(uint256 indexed oldVal, uint256 indexed newVal);

    function setRewardPeriod(uint256 rewardPeriod) external;

    function rewardPeriod() external view returns (uint256);

    event AuctionPeriodSet(uint256 indexed oldVal, uint256 indexed newVal);

    function setAuctionPeriod(uint256 auctionPeriod) external;

    function auctionPeriod() external view returns (uint256);

    event StRSRPayPeriodSet(uint256 indexed oldVal, uint256 indexed newVal);

    function setStRSRPayPeriod(uint256 stRSRPayPeriod) external;

    function stRSRPayPeriod() external view returns (uint256);

    event StRSRWithdrawalDelaySet(uint256 indexed oldVal, uint256 indexed newVal);

    function setStRSRWithdrawalDelay(uint256 stRSRWithdrawalDelay) external;

    function stRSRWithdrawalDelay() external view returns (uint256);

    event DefaultDelaySet(uint256 indexed oldVal, uint256 indexed newVal);

    function setDefaultDelay(uint256 defaultDelay) external;

    function defaultDelay() external view returns (uint256);

    event MaxTradeSlippageSet(Fix indexed oldVal, Fix indexed newVal);

    function setMaxTradeSlippage(Fix maxTradeSlippage) external;

    function maxTradeSlippage() external view returns (Fix);

    event DustAmountSet(Fix indexed oldVal, Fix indexed newVal);

    function setDustAmount(Fix dustAMount) external;

    function dustAmount() external view returns (Fix);

    event MinRevenueAuctionSizeSet(Fix indexed oldVal, Fix indexed newVal);

    function setMinRevenueAuctionSize(Fix backingBuffer) external;

    function backingBuffer() external view returns (Fix);

    event IssuanceRateSet(Fix indexed oldVal, Fix indexed newVal);

    function setIssuanceRate(Fix issuanceRate) external;

    function issuanceRate() external view returns (Fix);

    event DefaultThresholdSet(Fix indexed oldVal, Fix indexed newVal);

    function setDefaultThreshold(Fix defaultThreshold) external;

    function defaultThreshold() external view returns (Fix);

    event StRSRPayRatioSet(Fix indexed oldVal, Fix indexed newVal);

    function setStRSRPayRatio(Fix stRSRPayRatio) external;

    function stRSRPayRatio() external view returns (Fix);
}
