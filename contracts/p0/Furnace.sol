// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/p0/interfaces/IAsset.sol";
import "contracts/p0/interfaces/IFurnace.sol";
import "contracts/p0/interfaces/IRToken.sol";

/**
 * @title FurnaceP0
 * @notice A helper to melt RTokens slowly and permisionlessly.
 */
contract FurnaceP0 is Ownable, IFurnace {
    using SafeERC20 for IRToken;
    using FixLib for Fix;

    IRToken public immutable rToken;
    Fix public override ratio; // {1} What fraction of balance to melt each period
    uint256 public override period; // {seconds} How often to melt
    uint256 public lastPayout; // {seconds} The last time we did a payout

    constructor(
        IRToken rToken_,
        uint256 period_,
        Fix ratio_
    ) {
        require(address(rToken_) != address(0), "rToken is zero address");
        require(period_ != 0, "period cannot be zero");
        rToken = rToken_;
        period = period_;
        ratio = ratio_;
        lastPayout = block.timestamp;
    }

    /// Period setting
    function setPeriod(uint256 period_) external override onlyOwner {
        require(period_ != 0, "period cannot be zero");
        emit PeriodSet(period, period_);
        period = period_;
    }

    /// Ratio setting
    function setRatio(Fix ratio_) external override onlyOwner {
        // The ratio can safely be set to 0
        emit RatioSet(ratio, ratio_);
        ratio = ratio_;
    }

    /// Performs any melting that has vested since last call. Idempotent
    function melt() public override returns (uint256 amount) {
        if (block.timestamp < lastPayout + period) return 0;

        // # of whole periods that have passed since lastPayout
        uint256 numPeriods = (block.timestamp - lastPayout) / period;

        // Paying out the ratio r, N times, equals paying out the ratio (1 - (1-r)^N) 1 time.
        Fix payoutRatio = FIX_ONE.minus(FIX_ONE.minus(ratio).powu(numPeriods));

        amount = payoutRatio.mulu(rToken.balanceOf(address(this))).floor();

        if (amount > 0) rToken.melt(amount);
        lastPayout += numPeriods * period;
    }
}
