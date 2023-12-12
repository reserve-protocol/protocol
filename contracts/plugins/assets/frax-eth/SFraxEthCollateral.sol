// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "../../../libraries/Fixed.sol";
import "../AppreciatingFiatCollateral.sol";
import "../OracleLib.sol";
import "../FraxOracleLib.sol";
import "./vendor/IsfrxEth.sol";

/**
 * ************************************************************
 * WARNING: this plugin is not ready to be used in Production
 * ************************************************************
 */

/**
 * @title SFraxEthCollateral
 * @notice Collateral plugin for Frax-ETH,
 * tok = sfrxETH
 * ref = frxETH
 * tar = ETH
 * UoA = USD
 */
contract SFraxEthCollateral is AppreciatingFiatCollateral {
    using OracleLib for AggregatorV3Interface;
    using FraxOracleLib for FraxAggregatorV3Interface;
    using FixLib for uint192;

    FraxAggregatorV3Interface public immutable targetPerTokChainlinkFeed; // {target/tok}
    uint48 public immutable targetPerTokChainlinkTimeout;

    /// @param config.chainlinkFeed {UoA/target} price of ETH in USD terms
    /// @param _targetPerTokChainlinkFeed {target/tok} price of cbETH in ETH terms
    constructor(
        CollateralConfig memory config,
        uint192 revenueHiding,
        FraxAggregatorV3Interface _targetPerTokChainlinkFeed,
        uint48 _targetPerTokChainlinkTimeout
    ) AppreciatingFiatCollateral(config, revenueHiding) {
        require(config.defaultThreshold > 0, "defaultThreshold zero");
        require(address(_targetPerTokChainlinkFeed) != address(0), "missing targetPerTok feed");
        require(_targetPerTokChainlinkTimeout != 0, "targetPerTokChainlinkTimeout zero");

        targetPerTokChainlinkFeed = _targetPerTokChainlinkFeed;
        targetPerTokChainlinkTimeout = _targetPerTokChainlinkTimeout;
    }

    /// Can revert, used by other contract functions in order to catch errors
    /// @return low {UoA/tok} The low price estimate
    /// @return high {UoA/tok} The high price estimate
    /// @return pegPrice {target/ref} FIX_ONE until an oracle becomes available
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
        uint192 targetPerTok = targetPerTokChainlinkFeed.price(targetPerTokChainlinkTimeout);
        // {UoA/tok} = {UoA/target} * {target/tok}
        uint192 p = chainlinkFeed.price(oracleTimeout).mul(targetPerTok);
        uint192 err = p.mul(oracleError, CEIL);

        high = p + err;
        low = p - err;
        // assert(low <= high); obviously true just by inspection

        // {target/ref} = {target/tok} / {ref/tok}
        pegPrice = targetPerTok.div(_underlyingRefPerTok());
    }

    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    function _underlyingRefPerTok() internal view override returns (uint192) {
        return _safeWrap(IsfrxEth(address(erc20)).pricePerShare());
    }
}
