// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "contracts/fuzz/Utils.sol";
import "contracts/libraries/Fixed.sol";

/* A PriceModel keeps a "price" over time,

  - model.price() always just returns model.curr; here for future flexibility
  - model.update(uint192 seed) makes the price model take one updating "step". What happens to curr
    depends on model.kind. See the implementation for these price models, they're all pretty simple.
*/

enum Kind {
    Constant, // Constant price (ignores low + high)
    Manual, // Manually-set price (ignores low + high)
    Band, // Price fluctuates within the given band
    Walk // Price fluctuates as a random walk (in logspace)
}

struct PriceModel {
    Kind kind;
    uint192 curr;
    uint192 low;
    uint192 high;
}

library PriceModelLib {
    using FixLib for uint192;
    event SetPrice(string symbol, uint192 price);

    function price(PriceModel storage model) internal view returns (uint192) {
        return model.curr;
    }

    function update(PriceModel storage model, uint192 seed) internal {
        if (model.kind == Kind.Constant) return;
        else if (model.kind == Kind.Manual) {
            model.curr = uint192(seed);
        } else if (model.kind == Kind.Band) {
            model.curr = uint192(between(model.low, model.high, seed));
        } else if (model.kind == Kind.Walk) {
            uint192 mult = uint192(between(model.low, model.high, seed));
            model.curr = model.curr.mul(mult);
        }
    }
}
