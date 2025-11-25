// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "../../../libraries/Fixed.sol";
import "../Asset.sol";
import "../OracleLib.sol";
import "./vendor/IKing.sol";

/**
 * @title KingAsset
 * @notice Asset plugin for King token using ETH as intermediate pricing unit
 * tok = KING
 * UoA = USD
 * Pricing: KING/USD = (ETH/KING from fairValueOf) * (USD/ETH from oracle)
 */
contract KingAsset is IAsset, Asset {
    using FixLib for uint192;
    using OracleLib for AggregatorV3Interface;

    /// @param priceTimeout_ {s} The number of seconds over which savedHighPrice decays to 0
    /// @param ethUsdChainlinkFeed_ {UoA/ref} ETH/USD price feed
    /// @param oracleError_ {1} The % the oracle feed can be off by
    /// @param erc20_ The King ERC20 token
    /// @param maxTradeVolume_ {UoA} The max trade volume, in UoA
    /// @param oracleTimeout_ {s} The number of seconds until the oracle becomes invalid
    constructor(
        uint48 priceTimeout_,
        AggregatorV3Interface ethUsdChainlinkFeed_,
        uint192 oracleError_,
        IERC20Metadata erc20_,
        uint192 maxTradeVolume_,
        uint48 oracleTimeout_
    )
        Asset(
            priceTimeout_,
            ethUsdChainlinkFeed_,
            oracleError_,
            erc20_,
            maxTradeVolume_,
            oracleTimeout_
        )
    {
        // Validation is handled by parent Asset contract
    }

    /// Can revert, used by other contract functions in order to catch errors
    /// Should not return FIX_MAX for low
    /// Should only return FIX_MAX for high if low is 0
    /// Should NOT be manipulable by MEV
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
        // Note: "ref" in this context refers to ETH, used as intermediate pricing unit
        uint192 ethUsdPrice = chainlinkFeed.price(oracleTimeout); // {UoA/ref}
        uint192 ethPerKing = _safeWrap(IKing(address(erc20)).fairValueOf(10**erc20Decimals)); // {ref/tok}

        // {UoA/tok} = {UoA/ref} * {ref/tok}
        uint192 p = ethUsdPrice.mul(ethPerKing);
        uint192 err = p.mul(oracleError, CEIL);
        // assert(low <= high); obviously true just by inspection
        return (p - err, p + err, 0);
    }
}
