// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/libraries/Fixed.sol";
import "contracts/interfaces/IFurnace.sol";
import "contracts/p0/mixins/Component.sol";

/**
 * @title FurnaceP0
 * @notice A helper to melt RTokens slowly and permisionlessly.
 */
contract FurnaceP0 is Component, IFurnace {
    using FixLib for int192;

    int192 public ratio; // {1} What fraction of balance to melt each period
    uint256 public period; // {seconds} How often to melt
    uint256 public lastPayout; // {seconds} The last time we did a payout

    function init(ConstructorArgs calldata args) internal override {
        period = args.params.rewardPeriod;
        ratio = args.params.rewardRatio;
        lastPayout = block.timestamp;
        require(period != 0, "period cannot be zero");
    }

    /// Performs any melting that has vested since last call. Idempotent
    function melt() public returns (uint256 amount) {
        if (block.timestamp < lastPayout + period) return 0;

        // # of whole periods that have passed since lastPayout
        uint256 numPeriods = (block.timestamp - lastPayout) / period;

        // Paying out the ratio r, N times, equals paying out the ratio (1 - (1-r)^N) 1 time.
        int192 payoutRatio = FIX_ONE.minus(FIX_ONE.minus(ratio).powu(numPeriods));

        IRToken rToken = main.rToken();
        amount = payoutRatio.mulu(rToken.balanceOf(address(this))).floor();

        if (amount > 0) rToken.melt(amount);
        lastPayout += numPeriods * period;
    }

    /// Period setting
    function setPeriod(uint256 period_) external onlyOwner {
        require(period_ != 0, "period cannot be zero");
        emit PeriodSet(period, period_);
        period = period_;
    }

    /// Ratio setting
    function setRatio(int192 ratio_) external onlyOwner {
        // The ratio can safely be set to 0
        emit RatioSet(ratio, ratio_);
        ratio = ratio_;
    }
}
