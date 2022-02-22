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
import "contracts/p0/main/AssetRegistry.sol";
import "contracts/p0/main/Mixin.sol";
import "contracts/libraries/Fixed.sol";

/// Settings mixin for Main
// solhint-disable max-states-count
contract SettingsHandlerP0 is Ownable, Mixin, AssetRegistryP0, ISettingsHandler {
    using EnumerableSet for EnumerableSet.AddressSet;
    using FixLib for Fix;

    IMarket private _market;

    uint256 private _rewardStart;
    uint256 private _rewardPeriod;
    uint256 private _auctionPeriod;
    uint256 private _stRSRWithdrawalDelay;
    uint256 private _defaultDelay;

    Fix private _maxTradeSlippage;
    Fix private _maxAuctionSize;
    Fix private _minRevenueAuctionSize;
    Fix private _issuanceRate;
    Fix private _defaultThreshold;

    IStRSR private _stRSR;
    IFurnace private _revenueFurnace;

    IAsset private _rTokenAsset;
    IAsset private _rsrAsset;

    function init(ConstructorArgs calldata args) public virtual override(Mixin, AssetRegistryP0) {
        super.init(args);

        _market = args.market;
        _revenueFurnace = args.furnace;

        _rewardStart = args.config.rewardStart;
        _rewardPeriod = args.config.rewardPeriod;
        _auctionPeriod = args.config.auctionPeriod;
        _stRSRWithdrawalDelay = args.config.stRSRWithdrawalDelay;
        _defaultDelay = args.config.defaultDelay;

        _maxTradeSlippage = args.config.maxTradeSlippage;
        _maxAuctionSize = args.config.maxAuctionSize;
        _minRevenueAuctionSize = args.config.minRevenueAuctionSize;
        _issuanceRate = args.config.issuanceRate;
        _defaultThreshold = args.config.defaultThreshold;
    }

    function setStRSR(IStRSR stRSR_) external override onlyOwner {
        emit StRSRSet(_stRSR, stRSR_);
        _stRSR = stRSR_;
    }

    function stRSR() public view override returns (IStRSR) {
        return _stRSR;
    }

    function setRevenueFurnace(IFurnace revenueFurnace_) external override onlyOwner {
        emit RevenueFurnaceSet(_revenueFurnace, revenueFurnace_);
        _revenueFurnace = revenueFurnace_;
    }

    function revenueFurnace() public view override returns (IFurnace) {
        return _revenueFurnace;
    }

    function setRTokenAsset(IAsset rTokenAsset_) external override onlyOwner {
        _rTokenAsset = rTokenAsset_;
        emit RTokenAssetSet(_rTokenAsset, rTokenAsset_);
        activateAsset(_rTokenAsset);
    }

    function rTokenAsset() public view override returns (IAsset) {
        return _rTokenAsset;
    }

    function setRSRAsset(IAsset rsrAsset_) external override onlyOwner {
        _rsrAsset = rsrAsset_;
        emit RSRAssetSet(_rsrAsset, rsrAsset_);
        activateAsset(_rsrAsset);
    }

    function rsrAsset() public view override returns (IAsset) {
        return _rsrAsset;
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
        emit AuctionPeriodSet(_auctionPeriod, _auctionPeriod);
        _auctionPeriod = auctionPeriod_;
    }

    function auctionPeriod() public view override returns (uint256) {
        return _auctionPeriod;
    }

    function setStRSRWithdrawalDelay(uint256 stRSRWithdrawalDelay_) external override onlyOwner {
        emit StRSRWithdrawalDelaySet(_stRSRWithdrawalDelay, stRSRWithdrawalDelay_);
        _stRSRWithdrawalDelay = stRSRWithdrawalDelay_;
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

    function setMaxAuctionSize(Fix maxAuctionSize_) external override onlyOwner {
        emit MaxAuctionSizeSet(_maxAuctionSize, maxAuctionSize_);
        _maxAuctionSize = maxAuctionSize_;
    }

    function maxAuctionSize() public view override returns (Fix) {
        return _maxAuctionSize;
    }

    function setMinRevenueAuctionSize(Fix minRevenueAuctionSize_) external override onlyOwner {
        emit MinRevenueAuctionSizeSet(_minRevenueAuctionSize, minRevenueAuctionSize_);
        _minRevenueAuctionSize = minRevenueAuctionSize_;
    }

    function minRevenueAuctionSize() public view override returns (Fix) {
        return _minRevenueAuctionSize;
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

    function setMarket(IMarket market_) external override onlyOwner {
        emit MarketSet(_market, market_);
        _market = market_;
    }

    function market() external view override returns (IMarket) {
        return _market;
    }

    // Useful view functions for reading refAmts of the state
    /// @return The RToken deployment
    function rToken() public view override returns (IRToken) {
        return IRToken(address(_rTokenAsset.erc20()));
    }

    /// @return The RSR deployment
    function rsr() public view override returns (IERC20Metadata) {
        return IERC20Metadata(address(_rsrAsset.erc20()));
    }
}
