// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "contracts/p1/RTokenOracle.sol";

contract RTokenOracleMock is RTokenOracle {
    constructor(uint48 cacheTimeout_) RTokenOracle(cacheTimeout_) {}

    /// @param low {UoA/tok}
    /// @param high {UoA/tok}
    function setPrice(
        IRToken rToken,
        uint192 low,
        uint192 high
    ) external {
        Cache storage cache = entries[rToken];
        cache.price.low = low;
        cache.price.high = high;
        cache.savedAt = uint48(block.timestamp);
    }
}
