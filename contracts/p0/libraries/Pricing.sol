// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/libraries/Fixed.sol";
import "contracts/p0/interfaces/IMain.sol";

/// Prices are {attoUoA}
library PricingLib {
    function setUSD(Price memory self, Fix amt) internal pure {
        self.quantities[uint256(UoA.USD)] = amt;
    }

    function setEUR(Price memory self, Fix amt) internal pure {
        self.quantities[uint256(UoA.EUR)] = amt;
    }

    function setByEoA(
        Price memory self,
        UoA uoa,
        Fix amt
    ) internal pure {
        self.quantities[uint256(uoa)] = amt;
    }

    function usd(Price memory self) internal view returns (Fix) {
        return self.quantities[uint256(UoA.USD)];
    }

    function eur(Price memory self) internal view returns (Fix) {
        return self.quantities[uint256(UoA.EUR)];
    }

    function usd(Price storage self) internal view returns (Fix) {
        return self.quantities[uint256(UoA.USD)];
    }

    function eur(Price storage self) internal view returns (Fix) {
        return self.quantities[uint256(UoA.EUR)];
    }

    function byUoA(Price memory self, UoA uoa) internal view returns (Fix) {
        return self.quantities[uint256(uoa)];
    }
    // ...more
}
