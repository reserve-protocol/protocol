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

    uint256 targetTime; // {sec} Timestamp when the current batch is targeted to be all burned.
    uint256 prevTime; // {sec} Timestamp when some of the current batch was last burned.

    uint256 public override totalBurnt; // {qTok}

    constructor(address rToken_) {
        require(rToken_ != address(0), "rToken is zero address");

        rToken = IRTokenP1(rToken_);
    }

    /// Sets aside `amount` of RToken to be burnt over up to `timePeriod` seconds.
    /// @param amount {qTok} The amount of RToken to be burnt
    /// @param timePeriod {sec} The number of seconds to spread the burn over
    function burnOverPeriod(uint256 newAmount, uint256 duration) external override {
        require(amount > 0, "Cannot burn a batch of zero");

        // If there are already tokens in the furnace, burn them first.
        if(_bal() > 0 && prevTime <= targetTime) {
            doBurn();
        }

        uint oldAmount = _bal();
        uint256 newTargetTime = duration + block.timestamp;

        if(oldAmount == 0 ) { // || block.timestamp <= targetTime?
            // Start a new, simple burn plan.
            targetTime = duration + block.timestamp;
        } else {
            // We'll burn at whichever rate is faster:
            // 1. Burn all tokens, old and new, at a rate so that we finish by max(targetTime, newTargetTime)
            // 2. or, if it would be faster, keep burning at the old rate.

            // {qtok / sec}
            Fix oldRate = toFix(oldAmount).divu(targetTime - block.timestamp);
            uint256 combinedTargetTime = Math.max(newTargetTime, targetTime)
            Fix combinedRate = toFix(oldAmount + newAmount).divu(combinedTargetTime - block.timestamp);

            if (oldRate.gt(combinedRate)) { // use oldRate.
                targetTime = block.timestamp + divFix(oldAmount + newAmount, oldRate).toUint();
            } else {
                targetTime = combinedTargetTime;
            }
        }

        // Actually update the Furnace's balance.
        rToken.safeTransferFrom(_msgSender(), address(this), newAmount);
        emit DistributionCreated(amount, timePeriod, _msgSender());
    }

    /// Performs any burning that has vested since last call. Idempotent.
    function doBurn() external override {
        uint256 toBurn = _burnable(block.timestamp);
        if (toBurn == 0) return;

        totalBurnt += toBurn;
        prevTime = block.timestamp;

        bool success = rToken.burn(address(this), toBurn);
        require(success, "should have burned from self successfully");
        emit Burned(amount);
    }

    function _bal() internal view returns(uint256) { return rToken.balanceOf(address(this)); }

    /// Return how many tokens we could burn at `timestamp`.
    function _burnable(uint256 timestamp) internal returns (uint256) {
        if (timestamp >= target_time || _bal() == 0) return 0;
        if (target_time <= prev_time) return 0;

        return toFix(timestamp - prev_time).divu(target_time - prev_time).mulu(amount).toUint();
    }
}
