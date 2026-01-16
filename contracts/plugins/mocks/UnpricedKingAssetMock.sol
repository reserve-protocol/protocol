// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.28;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "../assets/etherfi/KingAsset.sol";
import "../assets/OracleLib.sol";

// Unpriced KingAsset mock for testing
contract UnpricedKingAssetMock is KingAsset {
    using FixLib for uint192;
    using OracleLib for AggregatorV3Interface;

    bool public unpriced = false;

    /// @param priceTimeout_ {s} The number of seconds over which savedHighPrice decays to 0
    /// @param chainlinkFeed_ Feed units: {UoA/tok}
    /// @param oracleError_ {1} The % the oracle feed can be off by
    /// @param maxTradeVolume_ {UoA} The max trade volume, in UoA
    /// @param oracleTimeout_ {s} The number of seconds until a oracle value becomes invalid
    constructor(
        uint48 priceTimeout_,
        AggregatorV3Interface chainlinkFeed_,
        uint192 oracleError_,
        IERC20Metadata erc20_,
        uint192 maxTradeVolume_,
        uint48 oracleTimeout_
    )
        KingAsset(
            priceTimeout_,
            chainlinkFeed_,
            oracleError_,
            erc20_,
            maxTradeVolume_,
            oracleTimeout_
        )
    {}

    /// tryPrice: mock unpriced by returning (0, FIX_MAX)
    function tryPrice()
        external
        view
        override
        returns (
            uint192 low,
            uint192 high,
            uint192
        )
    {
        // If unpriced is marked, return 0, FIX_MAX
        if (unpriced) return (0, FIX_MAX, 0);

        uint192 ethUsdPrice = chainlinkFeed.price(oracleTimeout); // {UoA/ref}
        (uint256 ethValue, ) = IKing(address(erc20)).fairValueOf(10**erc20Decimals);
        uint192 ethPerKing = _safeWrap(ethValue); // {ref/tok}
        uint192 p = ethUsdPrice.mul(ethPerKing); // {UoA/tok}
        uint192 delta = p.mul(oracleError, CEIL);
        return (p - delta, p + delta, 0);
    }

    function setUnpriced(bool on) external {
        unpriced = on;
    }
}
