// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./IRToken.sol";

struct Price {
    uint192 low; // {UoA/tok}
    uint192 high; // {UoA/tok}
}

interface IRTokenOracle {
    /// Lookup price by rToken with refresh if necessary
    /// @param forceRefresh If true, forces a refresh of the price regardless of cache status
    /// @return price {UoA/rTok} The current price
    /// @return timestamp {s} The timestamp at which price was saved
    function price(IRToken rToken, bool forceRefresh)
        external
        returns (Price memory price, uint48 timestamp);

    /// Lookup price by rToken without refresh
    /// @return price {UoA/rTok} The saved price
    /// @return timestamp {s} The timestamp at which price was saved
    function priceView(IRToken rToken) external view returns (Price memory price, uint48 timestamp);

    /// @return {s} The cache timeout for the oracle
    function cacheTimeout() external view returns (uint48);
}
