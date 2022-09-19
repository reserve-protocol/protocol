// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/interfaces/IRToken.sol";
import "./Fixed.sol";

// NOTE: This algorithm assumes the contract is running on PoS Ethereum and 100% of the
// network is online. It is possible for the battery to recharge up to 2/3 as fast
// depending on validator participation levels. Below 2/3 the chain halts, in which case
// the battery stops charging completely.
uint48 constant BLOCKS_PER_HOUR = 300; // {blocks/hour}

/// Applies a redemption throttle of X% every 300 blocks (~1 hour)
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
        uint192 charge = currentCharge(battery, maxCapacity);

        // Deduct any usage
        charge -= chargeToUse; // reverts on underflow

        // Update battery
        battery.lastCharge = charge;
        battery.lastBlock = uint48(block.number);
    }

    /// @param maxCapacity {1/hour} The max fraction of the supply that can be used in <=1 hour
    /// @return charge {1} The current battery charge, after accumulation
    function currentCharge(Battery storage battery, uint192 maxCapacity)
        internal
        view
        returns (uint192 charge)
    {
        uint48 blocks = uint48(block.number) - battery.lastBlock; // {blocks}

        // maxCapacity is <= FIX_ONE; maxCapacity * blocks <= 1e37
        // {1} = {1} + {1/hour} * {blocks} / {blocks/hour}
        charge = battery.lastCharge + ((maxCapacity * blocks) / BLOCKS_PER_HOUR);
        if (charge > maxCapacity) charge = maxCapacity;
    }
}
