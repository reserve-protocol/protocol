// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "../libraries/Fixed.sol";
import "../interfaces/IFurnace.sol";
import "./mixins/Component.sol";

/**
 * @title FurnaceP1
 * @notice A helper to melt RTokens continuously and permisionlessly.
 */
contract FurnaceP1 is ComponentP1, IFurnace {
    using FixLib for uint192;

    uint192 public constant MAX_RATIO = 1e14; // {1} 0.01%

    IRToken private rToken;

    // === Governance params ===
    uint192 public ratio; // {1} What fraction of balance to melt each period

    // === Cached ===
    uint48 public lastPayout; // {seconds} The last time we did a payout
    uint256 public lastPayoutBal; // {qRTok} The balance of RToken at the last payout

    // ==== Invariants ====
    // ratio <= MAX_RATIO = 1e18
    // lastPayout was the timestamp of the end of the last period we paid out
    //   (or, if no periods have been paid out, the timestamp init() was called)
    // lastPayoutBal was rtoken.balanceOf(this) after the last period we paid out
    //   (or, if no periods have been paid out, that balance when init() was called)

    function init(IMain main_, uint192 ratio_) external initializer {
        __Component_init(main_);
        rToken = main_.rToken();
        setRatio(ratio_);
        lastPayout = uint48(block.timestamp);
        lastPayoutBal = rToken.balanceOf(address(this));
    }

    // [furnace-payout-formula]:
    //   The process we're modelling is:
    //     N = number of whole periods since lastPayout
    //     bal_0 = rToken.balanceOf(this)
    //     payout_{i+1} = bal_i * ratio
    //     bal_{i+1} = bal_i - payout_{i+1}
    //     payoutAmount = sum{payout_i for i in [1...N]}
    //   thus:
    //     bal_N = bal_0 - payout
    //     bal_{i+1} = bal_i - bal_i * ratio = bal_i * (1-ratio)
    //     bal_N = bal_0 * (1-ratio)**N
    //   and so:
    //     payoutAmount = bal_N - bal_0 = bal_0 * (1 - (1-ratio)**N)

    /// Performs any melting that has vested since last call.
    /// @custom:refresher
    // let numPeriods = number of whole periods that have passed since `lastPayout`
    //     payoutAmount = RToken.balanceOf(this) * (1 - (1-ratio)**N) from [furnace-payout-formula]
    // effects:
    //   lastPayout' = lastPayout + numPeriods (end of last pay period)
    //   lastPayoutBal' = rToken.balanceOf'(this) (balance now == at end of pay leriod)
    // actions:
    //   rToken.melt(payoutAmount), paying payoutAmount to RToken holders

    function melt() public {
        if (uint48(block.timestamp) < uint64(lastPayout + 1)) return;

        // # of whole periods that have passed since lastPayout
        uint48 numPeriods = uint48((block.timestamp) - lastPayout);

        // Paying out the ratio r, N times, equals paying out the ratio (1 - (1-r)^N) 1 time.
        uint192 payoutRatio = FIX_ONE.minus(FIX_ONE.minus(ratio).powu(numPeriods));

        uint256 amount = payoutRatio.mulu_toUint(lastPayoutBal);

        lastPayout += numPeriods;
        lastPayoutBal = rToken.balanceOf(address(this)) - amount;
        if (amount != 0) rToken.melt(amount);
    }

    /// Ratio setting
    /// @custom:governance
    function setRatio(uint192 ratio_) public governance {
        require(ratio_ <= MAX_RATIO, "invalid ratio");
        melt(); // cannot revert

        // The ratio can safely be set to 0 to turn off payouts, though it is not recommended
        emit RatioSet(ratio, ratio_);
        ratio = ratio_;
    }

    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
     */
    uint256[47] private __gap;
}
