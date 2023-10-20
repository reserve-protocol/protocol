// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "../assets/Asset.sol";

contract AssetMock is Asset {
    bool public stale;

    uint192 private lowPrice;
    uint192 private highPrice;

    /// @param priceTimeout_ {s} The number of seconds over which savedHighPrice decays to 0
    /// @param chainlinkFeed_ Feed units: {UoA/tok}
    /// @param oracleError_ {1} The % the oracle feed can be off by
    /// @param maxTradeVolume_ {UoA} The max trade volume, in UoA
    /// @param oracleTimeout_ {s} The number of seconds until a oracle value becomes invalid
    /// @dev oracleTimeout_ is also used as the timeout value in price(), should be highest of
    ///      all assets' oracleTimeout in a collateral if there are multiple oracles
    constructor(
        uint48 priceTimeout_,
        AggregatorV3Interface chainlinkFeed_,
        uint192 oracleError_,
        IERC20Metadata erc20_,
        uint192 maxTradeVolume_,
        uint48 oracleTimeout_
    ) Asset(priceTimeout_, chainlinkFeed_, oracleError_, erc20_, maxTradeVolume_, oracleTimeout_) {}

    /// Can revert, used by other contract functions in order to catch errors
    /// Should not return FIX_MAX for low
    /// Should only return FIX_MAX for high if low is 0
    /// @dev The third (unused) variable is only here for compatibility with Collateral
    /// @return low {UoA/tok} The low price estimate
    /// @return high {UoA/tok} The high price estimate
    function tryPrice()
        external
        view
        virtual
        override
        returns (
            uint192 low,
            uint192 high,
            uint192
        )
    {
        require(!stale, "stale price");
        return (lowPrice, highPrice, 0);
    }

    /// Should not revert
    /// Refresh saved prices
    function refresh() public virtual override {
        stale = false;
    }

    function setStale(bool _stale) external {
        stale = _stale;
    }

    function setPrice(uint192 low, uint192 high) external {
        lowPrice = low;
        highPrice = high;
    }
}
