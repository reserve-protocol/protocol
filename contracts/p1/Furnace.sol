// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/libraries/Fixed.sol";
import "contracts/interfaces/IFurnace.sol";
import "contracts/p1/mixins/Component.sol";

/**
 * @title FurnaceP1
 * @notice A helper to melt RTokens slowly and permisionlessly.
 */
contract FurnaceP1 is ComponentP1, IFurnace {
    using FixLib for uint192;

    uint192 public ratio; // {1} What fraction of balance to melt each period
    uint32 public period; // {seconds} How often to melt
    uint32 public lastPayout; // {seconds} The last time we did a payout
    uint256 public lastPayoutBal; // {qRTok} The balance of RToken at the last payout

    function init(
        IMain main_,
        uint32 period_,
        uint192 ratio_
    ) external initializer {
        __Component_init(main_);
        period = period_;
        ratio = ratio_;
        lastPayout = uint32(block.timestamp);
        lastPayoutBal = main_.rToken().balanceOf(address(this));
        require(period != 0, "period cannot be zero");
    }

    /// Performs any melting that has vested since last call.
    /// @custom:refresher
    function melt() external notPaused {
        if (block.timestamp < uint64(lastPayout) + period) return;

        // # of whole periods that have passed since lastPayout
        uint32 numPeriods = (uint32(block.timestamp) - lastPayout) / period;

        // Paying out the ratio r, N times, equals paying out the ratio (1 - (1-r)^N) 1 time.
        uint192 payoutRatio = FIX_ONE.minus(FIX_ONE.minus(ratio).powu(numPeriods));

        IRToken rToken = main.rToken();
        uint256 amount = payoutRatio.mulu_toUint(lastPayoutBal);

        lastPayout += numPeriods * period;
        if (amount > 0) rToken.melt(amount);
        lastPayoutBal = rToken.balanceOf(address(this));
    }

    /// Period setting
    /// @custom:governance
    function setPeriod(uint32 period_) external governance {
        require(period_ != 0, "period cannot be zero");
        emit PeriodSet(period, period_);
        period = period_;
    }

    /// Ratio setting
    /// @custom:governance
    function setRatio(uint192 ratio_) external governance {
        // The ratio can safely be set to 0
        emit RatioSet(ratio, ratio_);
        ratio = ratio_;
    }
}
