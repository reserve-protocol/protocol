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
 * @notice A helper to burn RTokens slowly and permisionlessly.
 */
contract FurnaceP0 is Ownable, IFurnace {
    using SafeERC20 for IRToken;
    using FixLib for Fix;

    IRToken public immutable rToken;

    struct Batch {
        uint256 amount; // {qTok}
        uint256 start; // {timestamp}
        uint256 duration; // {sec}
        uint256 burnt; // {qTok}
    }

    Batch[] public batches;

    uint256 public override totalBurnt;
    uint256 public override batchDuration;

    /// @param batchDuration_ {sec} The number of seconds to spread the burn over
    constructor(IRToken rToken_, uint256 batchDuration_) {
        require(address(rToken_) != address(0), "rToken is zero address");

        rToken = rToken_;
        batchDuration = batchDuration_;
    }

    /// Sets aside `amount` of RToken to be burnt over `timePeriod` seconds.
    /// @param amount {qTok} The amount of RToken to be burnt
    function receiveERC20(IERC20 erc20, uint256 amount) external override {
        require(address(erc20) == address(rToken), "RToken melting only");
        require(amount > 0, "Cannot burn a batch of zero");

        rToken.safeTransferFrom(_msgSender(), address(this), amount);

        // Register handout
        batches.push(Batch(amount, block.timestamp, batchDuration, 0));
        emit DistributionCreated(amount, batchDuration, _msgSender());
    }

    /// Performs any burning that has vested since last call. Idempotent
    function doBurn() public override {
        uint256 amount = _burnable(block.timestamp);
        if (amount > 0) {
            bool success = rToken.burn(address(this), amount);
            require(success, "should burn from self successfully");
            totalBurnt += amount;
            emit Burned(amount);
        }
    }

    function setBatchDuration(uint256 batchDuration_) external override onlyOwner {
        batchDuration = batchDuration_;
    }

    function erc20Wanted() external view override returns (IERC20) {
        return rToken;
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
            // batch.amount{RTok} * (timestamp - batch.start) / batch.duration
            return toFix(timestamp - batch.start).divu(batch.duration).mulu(batch.amount).toUint();
        }
    }
}
