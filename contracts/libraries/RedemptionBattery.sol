// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/interfaces/IRToken.sol";
import "./Fixed.sol";

// NOTE: This algorithm assumes the contract is running on PoS Ethereum and 100% of the
// network is online. It is possible for the battery to recharge up to 2/3 as fast
// depending on validator participation levels. Below 2/3 the chain halts, in which case
// the battery stops charging completely.
uint48 constant BLOCKS_PER_HOUR = 300; // {blocks/hour}

/// Throttling mechanism:
/// Models a "battery" which "recharges" linearly block by block, over roughly 1 hour.
/// Calls to discharge() will revert if the battery doesn't have enough "charge".
/// @dev This implementation basically assumes that maxCapacity is always the same value.
///      It won't misbehave badly if maxCapacity is changed, but it doesn't have sharply-defined
///      behavior in that case. (But keeping maxCapacity outside storage saves SLOADs)
library RedemptionBatteryLib {
    using FixLib for uint192;

    struct Battery {
        uint48 lastBlock; // {blocks}
        uint192 lastCharge; // {1}
    }

    /// @param chargeToUse {charge} Fraction of the supply to use
    /// @param maxCapacity {charge} The maximum charge that can be used in one burst
    /// @dev Call after redemptions
    // let curr = battery.currentCharge(maxCapacity)
    // checks:
    //   chargeToUse <= curr
    // effects:
    //   battery.lastCharge' = curr - chargeToUse
    //   battery.lastBlock' = now
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

    /// @param maxCapacity {charge} The maximum charge that can be used in one burst
    /// @return charge {charge} The current charge of battery
    // let blocks = number of blocks since last discharge()
    //     chargePerBlock = maxCapacity / BLOCKS_PER_HOUR   (charge fully in 1 hour)
    // return: floor(min(maxCapacity, battery.lastCharge + chargePerBlock * blocks))
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
