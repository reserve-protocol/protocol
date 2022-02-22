// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/p0/interfaces/IAsset.sol";
import "contracts/libraries/Fixed.sol";

/// A specific definition of a BU that evolves over time according to the BasketConfig
struct Basket {
    // Invariant: all reference basket collateral must be registered with the registry
    ICollateral[] collateral;
    mapping(ICollateral => Fix) refAmts; // {ref/BU}
    uint256 nonce;
}

/*
 * @title BasketLib
 */
library BasketLib {
    using BasketLib for Basket;
    using FixLib for Fix;

    // Empty self
    function empty(Basket storage self) internal {
        for (uint256 i = 0; i < self.collateral.length; i++) {
            self.refAmts[self.collateral[i]] = FIX_ZERO;
        }
        delete self.collateral;
        self.nonce++;
    }

    /// Set `self` equal to `other`
    function copy(Basket storage self, Basket storage other) internal {
        empty(self);
        for (uint256 i = 0; i < other.collateral.length; i++) {
            ICollateral coll = other.collateral[i];
            self.collateral.push(coll);
            self.refAmts[coll] = other.refAmts[coll];
        }
        self.nonce++;
    }

    /// Add `weight` to the refAmount of collateral `coll` in the basket `self`
    function add(
        Basket storage self,
        ICollateral coll,
        Fix weight
    ) internal {
        if (self.refAmts[coll].eq(FIX_ZERO)) {
            self.collateral.push(coll);
            self.refAmts[coll] = weight;
        } else {
            self.refAmts[coll] = self.refAmts[coll].plus(weight);
        }
        self.nonce++;
    }
}
