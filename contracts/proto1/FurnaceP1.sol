// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/Context.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/proto1/interfaces/IFurnaceP1.sol";
import "contracts/proto1/interfaces/IRTokenP1.sol";

/**
 * @title FurnaceP1
 * @notice A helper contract to burn RTokens slowly and permisionlessly.
 */
contract FurnaceP1 is Context, IFurnaceP1 {
    using SafeERC20 for IRTokenP1;
    using FixLib for Fix;

    IRTokenP1 public immutable rToken;

    Fix public burnRate; // {qtok/sec} The rate at which this furnace now burns tokens. Set by burnOverPeriod.
    uint256 public whenPreviousBurn; // {sec} Timestamp when some of the current batch was last burned. Set by doBurn().
    uint256 public override totalBurnt; // {qTok} All-time total number of burnt tokens. Updated by doBurn().

    constructor(address rToken_) {
        require(rToken_ != address(0), "rToken is zero address");
        rToken = IRTokenP1(rToken_);
    }

    /// Sets aside `amount` of RToken to be burnt over up to `timePeriod` seconds.
    /// @param newAmount {qTok} The amount of RToken to be burnt
    /// @param duration {sec} The number of seconds to spread the burn over
    function burnOverPeriod(uint256 newAmount, uint256 duration) external override {
        require(newAmount > 0, "Cannot burn a batch of zero");

        // Bring state up-to-date
        doBurn();

        uint256 oldAmount = _bal();

        if (oldAmount == 0) {
            // No burn in progress. Start a new burn.
            burnRate = toFix(newAmount).divu(duration);
        } else {
            // Burn in progress; combine new burn with ongoing burn. Either (A) keep burning at `burnRate`, or (B) burn
            // both token amounts, together, at the rate that finishes both by the later of their two completion
            // times. Rate A is `burnRate`, and rate B is `togetherRate`. Use whichever is faster.

            // togetherDuration: {sec}. How long the togetherRate might burn.
            uint256 togetherDuration = Math.max(divFix(oldAmount, burnRate).toUint(), duration);
            // togetherRate: {qtok/sec}. The rate at which we can burn all current tokens.
            Fix togetherRate = toFix(oldAmount + newAmount).divu(togetherDuration);
            // Select rate.
            burnRate = fixMax(burnRate, togetherRate);
        }

        rToken.safeTransferFrom(_msgSender(), address(this), newAmount);
        emit DistributionCreated(newAmount, duration, _msgSender());
    }

    /// Performs any burning that has vested since last call. Idempotent.
    function doBurn() public override {
        uint256 toBurn = _burnable(block.timestamp);

        whenPreviousBurn = block.timestamp;
        totalBurnt += toBurn;

        if (toBurn == 0) return;
        bool success = rToken.burn(address(this), toBurn);
        require(success, "should have burned from self successfully");
        emit Burned(toBurn);
    }

    function _bal() internal view returns (uint256) {
        return rToken.balanceOf(address(this));
    }

    /// Return how many tokens we could burn at `timestamp`.
    function _burnable(uint256 timestamp) internal view returns (uint256) {
        if (timestamp <= whenPreviousBurn) return 0;

        return Math.max(_bal(), burnRate.mulu(timestamp - whenPreviousBurn).toUint());
    }
}
