// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/plugins/assets/abstract/CompoundOracleMixin.sol";

contract InvalidCompoundOracleMock is ICompoundOracle {
    mapping(string => uint256) private _prices;

    constructor() {}

    /// @param price_ {microUoA/tok} The UoA price of the corresponding token with 6 decimals.
    function setPrice(string memory symbol, uint256 price_) external {
        _prices[symbol] = price_;
    }

    // Dummy implementation - Reverts - Testing Purposes
    function price(string memory) external view returns (uint256) {
        revert();
        return 1; // Dummy, never returned
    }
}
