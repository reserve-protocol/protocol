// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "../libraries/Oracle.sol";

contract CompoundOracleMockP0 is ICompoundOracle {
    mapping(string => uint256) private _prices;

    constructor() {}

    /// @param price_ {microUSD/tok} The USD price of the corresponding token with 6 decimals.
    function setPrice(string memory symbol, uint256 price_) external {
        _prices[symbol] = price_;
    }

    /// @return {microUSD/tok} The USD price of the corresponding token with 6 decimals.
    function price(string memory symbol) external view override returns (uint256) {
        return _prices[symbol];
    }
}
