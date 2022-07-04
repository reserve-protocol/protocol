// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/interfaces/IAsset.sol";
import "contracts/plugins/abstract/Asset.sol";
import "contracts/fuzz/Utils.sol";
import "contracts/libraries/Fixed.sol";

/** AssetMock is an asset whose price can fluctuate according to a price model.
If the contract is constructed with values (_,_, kind, startPrice, low, high), then:

  - price() always returns the last price set by setPrice() (or, initially, startPrice)
  - setPrice() behaves follows the price model specified by the constructor. See the setPrice()
    implementation for these price models; they're all pretty simple.
 */

contract AssetMock is Asset {
    using FixLib for uint192;

    event SetPrice(string symbol, uint192 price);

    enum Kind {
        Constant, // Constant price
        Manual, // Manually-set price
        Band, // Price fluctuates within the given band
        Walk // Price fluctuates as a random walk (in logspace)
    }

    PriceKind kind;
    uint192 currPrice;
    uint192 low;
    uint192 high;

    constructor(
        IERC20Metadata erc20_,
        uint192 maxTradeVolume_,
        PriceKind kind_,
        uint192 startPrice,
        uint192 low_,
        uint192 high_
    ) Asset(erc20_, maxTradeVolume_) {
        currPrice = startPrice;
        kind = kind_;
        low = low_;
        high = high_;
        emit SetPrice(symbol(), currPrice);
    }

    /// @return {UoA/tok} Our best guess at the market price of 1 whole token in UoA
    function price() public view virtual returns (uint192) {
        return currPrice;
    }

    function setPrice(uint256 seed) public {
        if (kind == Kind.Constant) return;
        else if (kind == Kind.Manual) {
            assert(seed < type(uint192).max, "manual setPrice overflow");
            currPrice = uint192(seed);
        } else if (kind == Kind.Band) {
            currPrice = uint192(between(low, high, seed));
        } else if (kind == Kind.Walk) {
            mult = uint192(between(low, high, seed));
            currPrice = currPrice.mul(mult);
        }

        emit SetPrice(symbol(), currPrice);
    }
}
