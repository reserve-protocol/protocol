// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/interfaces/IRToken.sol";
import "./Fixed.sol";

uint48 constant BLOCKS_PER_HOUR = 277; // {blocks/hour}

/// Applies a redemption throttle of X% every 277 blocks (~1 hour)
/// @dev Use: call `discharge` after each redemption
/// @dev Reverts when a redemption is too large
library RedemptionBatteryLib {
    using FixLib for uint192;

    struct Battery {
        uint48 lastBlock; // {blocks}
        uint192 lastCharge; // {1}
    }

    /// @param chargeToUse {1} Fraction of the supply to use
    /// @param maxCapacity {1/hour} The max fraction of the supply that can be used in <=1 hour
    /// @dev Call after redemptions
    function discharge(
        Battery storage battery,
        uint192 chargeToUse,
        uint192 maxCapacity
    ) internal {
        uint48 blocks = uint48(block.number) - battery.lastBlock; // {blocks}

        // {1} = {1} + {1/hour} * {blocks} / {blocks/hour}
        uint192 charge = battery.lastCharge + ((maxCapacity * blocks) / BLOCKS_PER_HOUR);
        // maxCapacity is <= FIX_ONE; maxCapacity * blocks <= 1e37

        if (charge > maxCapacity) charge = maxCapacity;

        // Deduct any usage
        charge -= chargeToUse; // reverts on underflow

        // Update battery
        battery.lastCharge = charge;
        battery.lastBlock = uint48(block.number);
    }
}
