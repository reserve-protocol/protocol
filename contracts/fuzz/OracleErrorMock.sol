// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "contracts/plugins/assets/OracleLib.sol";

error PriceOutsideRange();

// A tiny mock that enables mock Assets and Collateral to fail like a real Oracle.
abstract contract OracleErrorMock {
    // Oracle errors
    bool public stalePrice = false;
    bool public priceOutsideRange = false;

    function maybeFail() internal view {
        if (stalePrice) revert StalePrice();
        if (priceOutsideRange) revert PriceOutsideRange();
    }

    function setStalePrice(bool v) external {
        stalePrice = v;
    }

    function setPriceOutsideRange(bool v) external {
        priceOutsideRange = v;
    }
}
