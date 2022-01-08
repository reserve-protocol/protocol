// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/libraries/Fixed.sol";
import "contracts/p0/interfaces/IMain.sol";

/// Prices are {attoUoA}
library PricingLib {
    function set(
        Price memory self,
        UoA uoa,
        Fix amt
    ) internal pure {
        self.quantities[uint256(uoa)] = amt;
    }

    function setUSD(Price memory self, Fix amt) internal pure {
        set(self, UoA.USD, amt);
    }

    function setEUR(Price memory self, Fix amt) internal pure {
        set(self, UoA.EUR, amt);
    }

    // View

    function quantity(Price memory self, UoA uoa) internal pure returns (Fix) {
        return self.quantities[uint256(uoa)];
    }

    function usd(Price memory self) internal pure returns (Fix) {
        return self.quantities[uint256(UoA.USD)];
    }

    function eur(Price memory self) internal pure returns (Fix) {
        return self.quantities[uint256(UoA.EUR)];
    }
}
