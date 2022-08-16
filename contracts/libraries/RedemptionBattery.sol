// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/interfaces/IRToken.sol";
import "./Fixed.sol";

uint256 constant ONE_HOUR_IN_BLOCKS = 277;

/// Applies a redemption throttle of X% every 277 blocks (~1 hour)
/// @dev Use: call `update` after each change to total supply
/// @dev Reverts when a redemption is too large
library RedemptionBatteryLib {
    using FixLib for uint192;

    struct Battery {
        uint256 lastBlock; // {blocknumber}
        uint256 lastSupply; // {qRTok}
        uint256 charge; // {qRTok}
    }

    /// @param maxRedemption {1} The maximum fraction of the supply that can be redeemed at once
    /// @param dustSupply {qRTok} The RToken supply at which full redemption becomes emabled
    /// @dev Call after any and all changes to the total supply
    function update(
        Battery storage battery,
        uint192 maxRedemption,
        uint256 dustSupply
    ) internal {
        uint256 currentSupply = IRToken(address(this)).totalSupply();

        if (maxRedemption > 0 && currentSupply > dustSupply) {
            uint256 blocks = block.number - battery.lastBlock; // {blocknumber}

            // {qRTok} = {1} * {qRTok}
            uint256 hourly = maxRedemption.mulu_toUint(battery.lastSupply);
            if (hourly < dustSupply) hourly = dustSupply;

            // {qRTok} = {qRTok} + {qRTok} * {blocknumber} / {blocknumber}
            uint256 newCharge = battery.charge + (hourly * blocks) / ONE_HOUR_IN_BLOCKS;
            battery.charge = newCharge > hourly ? hourly : newCharge;

            // Deduct any usage
            if (currentSupply < battery.lastSupply) {
                uint256 redemption = battery.lastSupply - currentSupply;
                battery.charge -= redemption; // reverts on underflow
            }
        }

        // Update cached values
        battery.lastSupply = currentSupply;
        battery.lastBlock = block.number;
    }
}
