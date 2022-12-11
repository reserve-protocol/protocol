// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "../libraries/Fixed.sol";
import "../interfaces/IFurnace.sol";
import "./mixins/Component.sol";

/**
 * @title FurnaceP0
 * @notice A helper to melt RTokens slowly and permisionlessly.
 */
contract FurnaceP0 is ComponentP0, IFurnace {
    using FixLib for uint192;

    uint192 public constant MAX_RATIO = 1e18;
    uint48 public constant MAX_PERIOD = 31536000; // {s} 1 year

    uint192 public ratio; // {1} What fraction of balance to melt each period
    uint48 public period; // {seconds} How often to melt
    uint48 public lastPayout; // {seconds} The last time we did a payout
    uint256 public lastPayoutBal; // {qRTok} The balance of RToken at the last payout

    function init(
        IMain main_,
        uint48 period_,
        uint192 ratio_
    ) public initializer {
        __Component_init(main_);
        setPeriod(period_);
        setRatio(ratio_);
        lastPayout = uint48(block.timestamp);
        lastPayoutBal = main_.rToken().balanceOf(address(this));
    }

    /// Performs any melting that has vested since last call.
    /// @custom:refresher
    function melt() external notPausedOrFrozen {
        if (uint48(block.timestamp) < uint64(lastPayout) + period) return;

        // # of whole periods that have passed since lastPayout
        uint48 numPeriods = (uint48(block.timestamp) - lastPayout) / period;

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
    function setPeriod(uint48 period_) public governance {
        require(period_ > 0 && period_ <= MAX_PERIOD, "invalid period");
        emit PeriodSet(period, period_);
        period = period_;
    }

    /// Ratio setting
    /// @custom:governance
    function setRatio(uint192 ratio_) public governance {
        require(ratio_ <= MAX_RATIO, "invalid ratio");
        // The ratio can safely be set to 0
        emit RatioSet(ratio, ratio_);
        ratio = ratio_;
    }
}
