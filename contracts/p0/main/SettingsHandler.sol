// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "contracts/p0/interfaces/IAsset.sol";
import "contracts/p0/interfaces/IClaimAdapter.sol";
import "contracts/p0/interfaces/IFurnace.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/interfaces/IMarket.sol";
import "contracts/p0/interfaces/IRToken.sol";
import "contracts/p0/interfaces/IStRSR.sol";
import "contracts/p0/main/Mixin.sol";
import "contracts/libraries/Fixed.sol";

/// Settings mixin for Main
// solhint-disable max-states-count
contract SettingsHandlerP0 is Ownable, Mixin, ISettingsHandler {
    using EnumerableSet for EnumerableSet.AddressSet;
    using FixLib for Fix;

    // Contracts
    IFurnace private _revenueFurnace;
    IMarket private _market;
    IERC20Metadata private _rsr;
    IStRSR private _stRSR;
    IRToken private _rToken;

    // Simple governance parameters
    uint256 private _rewardStart;
    uint256 private _rewardPeriod;
    uint256 private _auctionPeriod;
    uint256 private _stRSRPayPeriod;
    uint256 private _stRSRWithdrawalDelay;
    uint256 private _defaultDelay;

    Fix private _maxTradeSlippage;
    Fix private _dustAmount;
    Fix private _backingBuffer;
    Fix private _issuanceRate;
    Fix private _defaultThreshold;
    Fix private _stRSRPayRatio;

    function init(ConstructorArgs calldata args) public virtual override {
        super.init(args);

        _revenueFurnace = args.furnace;
        _market = args.market;
        _rsr = args.rsr;
        _stRSR = args.stRSR;
        _rToken = args.rToken;

        _rewardStart = args.config.rewardStart;
        _rewardPeriod = args.config.rewardPeriod;
        _auctionPeriod = args.config.auctionPeriod;
        _stRSRPayPeriod = args.config.stRSRPayPeriod;
        _stRSRWithdrawalDelay = args.config.stRSRWithdrawalDelay;
        _defaultDelay = args.config.defaultDelay;

        _maxTradeSlippage = args.config.maxTradeSlippage;
        _dustAmount = args.config.dustAmount;
        _backingBuffer = args.config.backingBuffer;
        _issuanceRate = args.config.issuanceRate;
        _defaultThreshold = args.config.defaultThreshold;
        _stRSRPayRatio = args.config.stRSRPayRatio;

        require(_stRSRPayPeriod * 2 < _stRSRWithdrawalDelay, "RSR pay period too long");
    }

    function setStRSR(IStRSR stRSR_) external override onlyOwner {
        emit StRSRSet(_stRSR, stRSR_);
        _stRSR = stRSR_;
    }

    function stRSR() public view override returns (IStRSR) {
        return _stRSR;
    }

    function setRevenueFurnace(IFurnace revenueFurnace_) external override onlyOwner {
        require(revenueFurnace_.batchDuration() == _rewardPeriod, "does not match rewardPeriod");
        emit RevenueFurnaceSet(_revenueFurnace, revenueFurnace_);
        _revenueFurnace = revenueFurnace_;
    }

    function revenueFurnace() public view override returns (IFurnace) {
        return _revenueFurnace;
    }

    function setRToken(IRToken rToken_) external override onlyOwner {
        _rToken = rToken_;
        emit RTokenSet(_rToken, rToken_);
    }

    function rToken() public view override returns (IRToken) {
        return _rToken;
    }

    function setRSR(IERC20Metadata rsr_) external override onlyOwner {
        _rsr = rsr_;
        emit RSRSet(_rsr, rsr_);
    }

    function rsr() public view override returns (IERC20Metadata) {
        return _rsr;
    }

    function setMarket(IMarket market_) external override onlyOwner {
        emit MarketSet(_market, market_);
        _market = market_;
    }

    function market() external view override returns (IMarket) {
        return _market;
    }

    function setRewardStart(uint256 rewardStart_) external override onlyOwner {
        emit RewardStartSet(_rewardStart, rewardStart_);
        _rewardStart = rewardStart_;
    }

    function rewardStart() public view override returns (uint256) {
        return _rewardStart;
    }

    function setRewardPeriod(uint256 rewardPeriod_) external override onlyOwner {
        emit RewardPeriodSet(_rewardPeriod, rewardPeriod_);
        _rewardPeriod = rewardPeriod_;
    }

    function rewardPeriod() public view override returns (uint256) {
        return _rewardPeriod;
    }

    function setAuctionPeriod(uint256 auctionPeriod_) external override onlyOwner {
        emit AuctionPeriodSet(_auctionPeriod, auctionPeriod_);
        _auctionPeriod = auctionPeriod_;
    }

    function auctionPeriod() public view override returns (uint256) {
        return _auctionPeriod;
    }

    function setStRSRPayPeriod(uint256 stRSRPayPeriod_) external override onlyOwner {
        emit StRSRPayPeriodSet(_stRSRPayPeriod, stRSRPayPeriod_);
        _stRSRPayPeriod = stRSRPayPeriod_;
        require(_stRSRPayPeriod * 2 <= _stRSRWithdrawalDelay, "RSR pay period too long");
    }

    function stRSRPayPeriod() public view returns (uint256) {
        return _stRSRPayPeriod;
    }

    function setStRSRWithdrawalDelay(uint256 stRSRWithdrawalDelay_) external override onlyOwner {
        emit StRSRWithdrawalDelaySet(_stRSRWithdrawalDelay, stRSRWithdrawalDelay_);
        _stRSRWithdrawalDelay = stRSRWithdrawalDelay_;
        require(_stRSRPayPeriod * 2 <= _stRSRWithdrawalDelay, "RSR withdrawal delay too short");
    }

    function stRSRWithdrawalDelay() public view override returns (uint256) {
        return _stRSRWithdrawalDelay;
    }

    function setDefaultDelay(uint256 defaultDelay_) external override onlyOwner {
        emit DefaultDelaySet(_defaultDelay, defaultDelay_);
        _defaultDelay = defaultDelay_;
    }

    function defaultDelay() public view override returns (uint256) {
        return _defaultDelay;
    }

    function setMaxTradeSlippage(Fix maxTradeSlippage_) external override onlyOwner {
        emit MaxTradeSlippageSet(_maxTradeSlippage, maxTradeSlippage_);
        _maxTradeSlippage = maxTradeSlippage_;
    }

    function maxTradeSlippage() public view override returns (Fix) {
        return _maxTradeSlippage;
    }

    function setDustAmount(Fix dustAmount_) external override onlyOwner {
        emit DustAmountSet(_dustAmount, dustAmount_);
        _dustAmount = dustAmount_;
    }

    function dustAmount() public view override returns (Fix) {
        return _dustAmount;
    }

    function setMinRevenueAuctionSize(Fix backingBuffer_) external override onlyOwner {
        emit MinRevenueAuctionSizeSet(_backingBuffer, backingBuffer_);
        _backingBuffer = backingBuffer_;
    }

    function backingBuffer() public view override returns (Fix) {
        return _backingBuffer;
    }

    function setIssuanceRate(Fix issuanceRate_) external override onlyOwner {
        emit IssuanceRateSet(_issuanceRate, issuanceRate_);
        _issuanceRate = issuanceRate_;
    }

    function issuanceRate() public view override returns (Fix) {
        return _issuanceRate;
    }

    function setDefaultThreshold(Fix defaultThreshold_) external override onlyOwner {
        emit DefaultThresholdSet(_defaultThreshold, defaultThreshold_);
        _defaultThreshold = defaultThreshold_;
    }

    function defaultThreshold() public view override returns (Fix) {
        return _defaultThreshold;
    }

    function setStRSRPayRatio(Fix stRSRPayRatio_) external {
        emit StRSRPayRatioSet(_stRSRPayRatio, stRSRPayRatio_);
        _stRSRPayRatio = stRSRPayRatio_;
    }

    function stRSRPayRatio() public view returns (Fix) {
        return _stRSRPayRatio;
    }
}
