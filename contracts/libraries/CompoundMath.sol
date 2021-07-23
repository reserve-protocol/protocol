// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity ^0.8.0;

import "./ABDKMath64x64.sol";

library CompoundMath {
    /**
     * Compounds (scale + compoundRate) / scale over timedelta periods.
     * Returns a uint256 relative to scale.
     *
     * @param scale unsigned 256-bit integer number
     * @param compoundRate unsigned 256-bit integer number
     * @param timedelta unsigned 256-bit integer number
     * @return unsigned 256-bit integer number
     */
    function compound(uint256 scale, uint256 compoundRate, uint256 timedelta) external pure returns (uint256) {
      return ABDKMath64x64.mulu(
        ABDKMath64x64.pow(
            ABDKMath64x64.divu(scale + compoundRate, scale), 
            timedelta
        ), scale);
    }

}
