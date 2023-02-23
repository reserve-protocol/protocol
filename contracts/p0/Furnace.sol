// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "../libraries/Fixed.sol";
import "../interfaces/IFurnace.sol";
import "./mixins/Component.sol";

/**
 * @title FurnaceP0
 * @notice A helper to melt RTokens continuously and permisionlessly.
 */
contract FurnaceP0 is ComponentP0, IFurnace {
    using FixLib for uint192;

    uint192 public constant MAX_RATIO = FIX_ONE; // {1} 100%
    uint48 public constant PERIOD = 12; // {s} 12 seconds; 1 block on PoS Ethereum

    uint192 public ratio; // {1} What fraction of balance to melt each PERIOD

    // === Cached ===
    uint48 public lastPayout; // {seconds} The last time we did a payout
    uint256 public lastPayoutBal; // {qRTok} The balance of RToken at the last payout

    function init(IMain main_, uint192 ratio_) public initializer {
        __Component_init(main_);
        setRatio(ratio_);
        lastPayout = uint48(block.timestamp);
        lastPayoutBal = main_.rToken().balanceOf(address(this));
    }

    /// Performs any melting that has vested since last call.
    /// @custom:refresher
    function melt() public notPausedOrFrozen {
        if (uint48(block.timestamp) < uint64(lastPayout) + PERIOD) return;

        // # of whole periods that have passed since lastPayout
        uint48 numPeriods = (uint48(block.timestamp) - lastPayout) / PERIOD;

        // Paying out the ratio r, N times, equals paying out the ratio (1 - (1-r)^N) 1 time.
        uint192 payoutRatio = FIX_ONE.minus(FIX_ONE.minus(ratio).powu(numPeriods));

        IRToken rToken = main.rToken();
        uint256 amount = payoutRatio.mulu_toUint(lastPayoutBal);

        lastPayout += numPeriods * PERIOD;

        // solhint-disable-next-line no-empty-blocks
        if (amount > 0) rToken.melt(amount);
        lastPayoutBal = rToken.balanceOf(address(this));
    }

    /// Ratio setting
    /// @custom:governance
    function setRatio(uint192 ratio_) public governance {
        // solhint-disable-next-line no-empty-blocks
        try this.melt() {} catch {}
        require(ratio_ <= MAX_RATIO, "invalid ratio");
        // The ratio can safely be set to 0, though it is not recommended
        emit RatioSet(ratio, ratio_);
        ratio = ratio_;
    }
}
