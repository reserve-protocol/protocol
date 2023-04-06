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

    /// Lookup price by rToken with refresh if necessary
    /// @param forceRefresh If true, forces a refresh of the price regardless of cache status
    /// @return price {UoA/rTok} The current price
    /// @return timestamp {s} The timestamp at which price was saved
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

    /// Lookup price by rToken without refresh
    /// @param allowStalePrice If false, requires the returned price is within the cacheTimeout
    /// @return price {UoA/rTok} The saved price
    /// @return timestamp {s} The timestamp at which price was saved
    function priceView(IRToken rToken, bool allowStalePrice)
        external
        view
        returns (Price memory, uint48)
    {
        Cache storage cache = entries[rToken];
        require(
            allowStalePrice || block.timestamp - cache.savedAt <= cacheTimeout,
            "call refresh()"
        );
        return (cache.price, cache.savedAt);
    }
}
