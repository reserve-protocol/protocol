// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import { CEIL, FixLib, _safeWrap } from "../../../libraries/Fixed.sol";
import { AggregatorV3Interface, OracleLib } from "../OracleLib.sol";
import { CollateralConfig, AppreciatingFiatCollateral } from "../AppreciatingFiatCollateral.sol";
import { IReth } from "./vendor/IReth.sol";

/**
 * @title RethCollateral
 * @notice Collateral plugin for Rocket-Pool ETH,
 * tok = rETH
 * ref = ETH
 * tar = ETH
 * UoA = USD
 */
contract RethCollateral is AppreciatingFiatCollateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    AggregatorV3Interface public immutable refPerTokChainlinkFeed;
    uint48 public immutable refPerTokChainlinkTimeout;

    /// @param config.chainlinkFeed Feed units: {UoA/ref}
    constructor(
        CollateralConfig memory config,
        uint192 revenueHiding,
        AggregatorV3Interface _refPerTokChainlinkFeed,
        uint48 _refPerTokChainlinkTimeout
    ) AppreciatingFiatCollateral(config, revenueHiding) {
        require(address(_refPerTokChainlinkFeed) != address(0), "missing refPerTok feed");
        require(_refPerTokChainlinkTimeout != 0, "refPerTokChainlinkTimeout zero");
        refPerTokChainlinkFeed = _refPerTokChainlinkFeed;
        refPerTokChainlinkTimeout = _refPerTokChainlinkTimeout;
    }

    /// Can revert, used by other contract functions in order to catch errors
    /// @return low {UoA/tok} The low price estimate
    /// @return high {UoA/tok} The high price estimate
    /// @return pegPrice {target/ref} The actual price observed in the peg
    function tryPrice()
        external
        view
        override
        returns (
            uint192 low,
            uint192 high,
            uint192 pegPrice
        )
    {
        uint192 spotRefPrTok = refPerTokChainlinkFeed.price(refPerTokChainlinkTimeout);
        // {UoA/tok} = {UoA/ref} * {ref/tok}
        uint192 p = chainlinkFeed.price(oracleTimeout).mul(spotRefPrTok);
        uint192 err = p.mul(oracleError, CEIL);

        high = p + err;
        low = p - err;
        // assert(low <= high); obviously true just by inspection

        pegPrice = _underlyingRefPerTok().div(spotRefPrTok); // {target/ref}
    }

    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    function _underlyingRefPerTok() internal view override returns (uint192) {
        return _safeWrap(IReth(address(erc20)).getExchangeRate());
    }
}
