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

    uint256 public override batchDuration;

    struct Batch {
        uint256 amount; // {qTok}
        uint256 start; // {timestamp}
        uint256 duration; // {sec}
        uint256 melted; // {qTok}
    }

    Batch[] public batches;

    /// @param batchDuration_ {sec} The number of seconds to spread the melt over
    constructor(IRToken rToken_, uint256 batchDuration_) {
        require(address(rToken_) != address(0), "rToken is zero address");

        rToken = rToken_;
        batchDuration = batchDuration_;
    }

    /// Causes the Furnace to re-examine its holdings and create new batches.
    function notifyOfDeposit(IERC20 erc20) external override {
        require(address(erc20) == address(rToken), "RToken melting only");

        // Register handout
        uint256 balance = erc20.balanceOf(address(this));
        uint256 batchTotal;
        for (uint256 i = 0; i < batches.length; i++) {
            Batch storage batch = batches[i];
            batchTotal += batch.amount - batch.melted;
        }

        uint256 amount = balance - batchTotal;
        if (amount > 0) {
            batches.push(Batch(amount, block.timestamp, batchDuration, 0));
            emit DistributionCreated(amount, batchDuration, _msgSender());
        }
    }

    /// Performs any burning that has vested since last call. Idempotent
    function doMelt() public override {
        uint256 amount = _burnable(block.timestamp);
        if (amount > 0) {
            bool success = rToken.melt(address(this), amount);
            require(success, "should melt from self successfully");
            emit Melted(amount);
        }
    }

    function setBatchDuration(uint256 batchDuration_) external override onlyOwner {
        batchDuration = batchDuration_;
    }

    function _burnable(uint256 timestamp) private returns (uint256) {
        uint256 releasable = 0;
        for (uint256 i = 0; i < batches.length; i++) {
            Batch storage batch = batches[i];

            // Check if there are still funds to be melted
            if (batch.melted < batch.amount) {
                uint256 vestedAmount = _vestedAmount(batch, timestamp);

                // Release amount
                releasable += vestedAmount - batch.melted;

                // Update melted
                batch.melted = vestedAmount;

                // Note: Potential optimization by cleaning up Batch once all consumed
            }

            // Note:  Potential optimization by increasing handoutIndex
        }

        return releasable;
    }

    function _vestedAmount(Batch storage batch, uint256 timestamp) private view returns (uint256) {
        if (timestamp <= batch.start) {
            return 0;
        } else if (timestamp > batch.start + batch.duration) {
            return batch.amount;
        } else {
            // batch.amount{RTok} * (timestamp - batch.start) / batch.duration
            return
                toFix(timestamp - batch.start)
                    .divu(batch.duration)
                    .mulu(batch.amount)
                    .toUintFloor();
        }
    }
}
