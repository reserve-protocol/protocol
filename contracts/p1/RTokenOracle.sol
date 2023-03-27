// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "contracts/interfaces/IRTokenOracle.sol";

struct Cache {
    Price price;
    uint48 savedAt; // {s}
}

contract RTokenOracle is IRTokenOracle {
    uint48 public cacheTimeout; // {s} How long a cached price is assumed valid

    mapping(IRToken => Cache) public entries;

    constructor(uint48 cacheTimeout_) {
        cacheTimeout = cacheTimeout_;
    }

    /// Lookup price by asset with refresh if necessary
    function price(IRToken rToken, bool forceRefresh) external returns (Price memory, uint48) {
        Cache storage cache = entries[rToken];

        // Refresh cache if stale
        if (forceRefresh || block.timestamp - cache.savedAt > cacheTimeout) {
            IAsset rTokenAsset = rToken.main().assetRegistry().toAsset(IERC20(address(rToken)));
            (cache.price.low, cache.price.high) = rTokenAsset.price();
            cache.savedAt = uint48(block.timestamp); // block time assumed reasonable
        }

        return (cache.price, cache.savedAt);
    }

    /// Lookup price by asset with refresh if necessary
    function priceView(IRToken rToken) external view returns (Price memory, uint48) {
        Cache storage cache = entries[rToken];
        return (cache.price, cache.savedAt);
    }
}
