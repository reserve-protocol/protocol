// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/plugins/assets/abstract/CompoundOracleMixin.sol";

contract InvalidCompoundOracleMock is ICompoundOracle {
    mapping(string => uint256) private _prices;

    bool public shouldFailAssert;

    constructor() {}

    /// @param price_ {microUoA/tok} The UoA price of the corresponding token with 6 decimals.
    function setPrice(string memory symbol, uint256 price_) external {
        _prices[symbol] = price_;
    }

    function setShouldFailAssert(bool newValue) external {
        shouldFailAssert = newValue;
    }

    // Dummy implementation - Reverts or fails an assertion - Testing Purposes
    function price(string memory) external view returns (uint256) {
        if (shouldFailAssert) {
            assert(false);
        } else {
            revert();
        }
        return 1; // Dummy, never returned
    }
}
