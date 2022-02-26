// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/p0/Component.sol";

/// Protocol governance settings
contract SettingsP0 is Component, ISettings {
    uint256 public rewardStart;

    function setRewardStart(uint256 val) external override onlyOwner {
        emit RewardStartSet(rewardStart, val);
        rewardStart = val;
    }

    uint256 public rewardPeriod;

    function setRewardPeriod(uint256 val) external override onlyOwner {
        emit RewardPeriodSet(rewardPeriod, val);
        rewardPeriod = val;
    }

    uint256 public auctionPeriod;

    function setAuctionPeriod(uint256 val) external override onlyOwner {
        emit AuctionPeriodSet(auctionPeriod, val);
        auctionPeriod = val;
    }

    uint256 public stRSRPayPeriod;

    function setStRSRPayPeriod(uint256 val) external {
        emit StRSRPayPeriodSet(stRSRPayPeriod, val);
        stRSRPayPeriod = val;
        require(stRSRPayPeriod * 2 <= stRSRWithdrawalDelay, "RSR pay period too long");
    }

    uint256 public stRSRWithdrawalDelay;

    function setStRSRWithdrawalDelay(uint256 val) external override onlyOwner {
        emit StRSRWithdrawalDelaySet(stRSRWithdrawalDelay, val);
        stRSRWithdrawalDelay = val;
        require(stRSRPayPeriod * 2 <= stRSRWithdrawalDelay, "RSR withdrawal delay too short");
    }

    uint256 public defaultDelay;

    function setDefaultDelay(uint256 val) external override onlyOwner {
        emit DefaultDelaySet(defaultDelay, val);
        defaultDelay = val;
    }

    Fix public maxTradeSlippage;

    function setMaxTradeSlippage(Fix val) external override onlyOwner {
        emit MaxTradeSlippageSet(maxTradeSlippage, val);
        maxTradeSlippage = val;
    }

    Fix public dustAmount;

    function setDustAmount(Fix val) external override onlyOwner {
        emit DustAmountSet(dustAmount, val);
        dustAmount = val;
    }

    Fix public backingBuffer;

    // TODO: fixup name
    function setMinRevenueAuctionSize(Fix val) external override onlyOwner {
        emit MinRevenueAuctionSizeSet(backingBuffer, val);
        backingBuffer = val;
    }

    Fix public issuanceRate;

    function setIssuanceRate(Fix val) external override onlyOwner {
        emit IssuanceRateSet(issuanceRate, val);
        issuanceRate = val;
    }

    Fix public defaultThreshold;

    function setDefaultThreshold(Fix val) external override onlyOwner {
        emit DefaultThresholdSet(defaultThreshold, val);
        defaultThreshold = val;
    }

    Fix public stRSRPayRatio;

    function setStRSRPayRatio(Fix val) external {
        emit StRSRPayRatioSet(stRSRPayRatio, val);
        stRSRPayRatio = val;
    }

    function init(ConstructorArgs calldata args) internal override {
        rewardStart = args.config.rewardStart;
        rewardPeriod = args.config.rewardPeriod;
        auctionPeriod = args.config.auctionPeriod;
        stRSRPayPeriod = args.config.stRSRPayPeriod;
        stRSRWithdrawalDelay = args.config.stRSRWithdrawalDelay;
        defaultDelay = args.config.defaultDelay;

        maxTradeSlippage = args.config.maxTradeSlippage;
        dustAmount = args.config.dustAmount;
        backingBuffer = args.config.backingBuffer;
        issuanceRate = args.config.issuanceRate;
        defaultThreshold = args.config.defaultThreshold;
        stRSRPayRatio = args.config.stRSRPayRatio;

        require(stRSRPayPeriod * 2 < stRSRWithdrawalDelay, "RSR pay period too long");
    }
}
