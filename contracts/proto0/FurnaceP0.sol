// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "./interfaces/IFurnace.sol";
import "./interfaces/IRToken.sol";

/**
 * @title FurnaceP0
 * @notice A helper contract to burn RTokens slowly and permisionlessly.
 */
contract FurnaceP0 is IFurnace {
    using SafeERC20 for IRToken;

    IRToken public immutable rToken;

    struct Batch {
        uint256 amount;
        uint256 start; // Start timestamp
        uint256 duration; // Duration in seconds
        uint256 burnt; // Amount already burnt
    }

    Batch[] public batches;

    uint256 public override totalBurnt;

    constructor(address rToken_) {
        require(rToken_ != address(0), "rToken is zero address");

        rToken = IRToken(rToken_);
    }

    /// @notice Sets aside `amount` of RToken to be burnt over `timePeriod` seconds.
    /// @param amount The amount of RToken to be burnt {qRToken}
    /// @param timePeriod The number of seconds to spread the burn over
    function burnOverPeriod(uint256 amount, uint256 timePeriod) external override {
        require(amount > 0, "Cannot burn a batch of zero");

        rToken.safeTransferFrom(msg.sender, address(this), amount);

        // Register handout
        batches.push(Batch(amount, block.timestamp, timePeriod, 0));
        emit Distribution(amount, timePeriod, msg.sender);
    }

    /// @notice Performs any burning that has vested since last call. Idempotent
    function doBurn() external override {
        uint256 amount = _burnable(block.timestamp);
        if (amount > 0) {
            require(rToken.burn(address(this), amount), "should burn from self successfully");
            totalBurnt += amount;
            emit Burn(amount);
        }
    }

    function _burnable(uint256 timestamp) internal returns (uint256) {
        uint256 releasable = 0;
        for (
            uint256 index = 0; /*handoutIndex*/
            index < batches.length;
            index++
        ) {
            Batch storage batch = batches[index];

            // Check if there are still funds to be burnt
            if (batch.burnt < batch.amount) {
                uint256 vestedAmount = _vestedAmount(batch, timestamp);

                // Release amount
                releasable += vestedAmount - batch.burnt;

                // Update burnt
                batch.burnt = vestedAmount;

                // Note: Potential optimization by cleaning up Batch once all consumed
            }

            // Note:  Potential optimization by increasing handoutIndex
        }

        return releasable;
    }

    function _vestedAmount(Batch storage batch, uint256 timestamp) internal view returns (uint256) {
        if (timestamp <= batch.start) {
            return 0;
        } else if (timestamp > batch.start + batch.duration) {
            return batch.amount;
        } else {
            return (batch.amount * (timestamp - batch.start)) / batch.duration;
        }
    }
}
