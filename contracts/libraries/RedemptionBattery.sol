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
        uint256 redemptionRateFloor; // {qRTok/hour} the floor of the battery charging rate
        uint192 scalingRedemptionRate; // {1/hour} charging rate as a fraction of supply
        // for either: set to 0 to disable
        // ===
        uint48 lastBlock; // {blocks}
        uint256 lastCharge; // {qRTok}
    }

    /// @param supply {qRTok} Total RToken supply before redemption
    /// @param amount {qRTok} Amount of RToken being redeemed
    function discharge(
        Battery storage battery,
        uint256 supply,
        uint256 amount
    ) internal {
        if (battery.redemptionRateFloor == 0 && battery.scalingRedemptionRate == 0) return;

        // {qRTok}
        uint256 charge = currentCharge(battery, supply);

        // A nice error message so people aren't confused why redemption failed
        require(amount <= charge, "redemption battery insufficient");

        // Update battery
        battery.lastBlock = uint48(block.number);
        battery.lastCharge = charge - amount;
    }

    /// @param supply {qRTok} Total RToken supply before the burn step
    /// @return charge {qRTok} The current total charge as an amount of RToken
    function currentCharge(Battery storage battery, uint256 supply)
        internal
        view
        returns (uint256 charge)
    {
        // {qRTok/hour} = {qRTok} * D18{1/hour} / D18
        uint256 amtPerHour = (supply * battery.scalingRedemptionRate) / FIX_ONE_256;

        if (battery.redemptionRateFloor > amtPerHour) amtPerHour = battery.redemptionRateFloor;

        // {blocks}
        uint48 blocks = uint48(block.number) - battery.lastBlock;

        // {qRTok} = {qRTok} + {qRTok/hour} * {blocks} / {blocks/hour}
        charge = battery.lastCharge + (amtPerHour * blocks) / BLOCKS_PER_HOUR;

        uint256 maxCharge = amtPerHour > supply ? supply : amtPerHour;
        if (charge > maxCharge) charge = maxCharge;
    }
}
