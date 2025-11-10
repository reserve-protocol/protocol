// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.28;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { CEIL, FixLib, _safeWrap } from "../../../libraries/Fixed.sol";
import { AggregatorV3Interface, OracleLib } from "../OracleLib.sol";
import { CollateralConfig, AppreciatingFiatCollateral } from "../AppreciatingFiatCollateral.sol";
import { IStaderStakePoolManager } from "./vendor/IStaderStakePoolManager.sol";
import { IETHx } from "./vendor/IETHx.sol";

/**
 * @title Stader ETHx collateral
 * @notice Collateral plugin for Stader ETHx
 * tok = ETHx
 * ref = ETH2
 * tar = ETH
 * UoA = USD
 */
contract ETHxCollateral is AppreciatingFiatCollateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    AggregatorV3Interface public immutable targetPerTokChainlinkFeed;
    uint48 public immutable targetPerTokChainlinkTimeout;

    /// @param config.chainlinkFeed {UoA/target} price of ETH in USD terms
    /// @param _targetPerTokChainlinkFeed {target/tok} price of ETHx in ETH terms
    constructor(
        CollateralConfig memory config,
        uint192 revenueHiding,
        AggregatorV3Interface _targetPerTokChainlinkFeed,
        uint48 _targetPerTokChainlinkTimeout
    ) AppreciatingFiatCollateral(config, revenueHiding) {
        require(address(_targetPerTokChainlinkFeed) != address(0), "missing targetPerTok feed");
        require(_targetPerTokChainlinkTimeout != 0, "targetPerTokChainlinkTimeout zero");
        require(config.defaultThreshold != 0, "defaultThreshold zero");

        targetPerTokChainlinkFeed = _targetPerTokChainlinkFeed;
        targetPerTokChainlinkTimeout = _targetPerTokChainlinkTimeout;
        maxOracleTimeout = uint48(Math.max(maxOracleTimeout, _targetPerTokChainlinkTimeout));
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
        uint192 targetPerTok = targetPerTokChainlinkFeed.price(targetPerTokChainlinkTimeout);

        // {UoA/tok} = {UoA/target} * {target/tok}
        uint192 p = chainlinkFeed.price(oracleTimeout).mul(targetPerTok);
        uint192 err = p.mul(oracleError, CEIL);

        high = p + err;
        low = p - err;
        // assert(low <= high); obviously true just by inspection

        // {target/ref} = {target/tok} / {ref/tok}
        pegPrice = targetPerTok.div(underlyingRefPerTok());
    }

    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    function underlyingRefPerTok() public view override returns (uint192) {
        IStaderStakePoolManager staderStakePoolManager = IStaderStakePoolManager(
            IETHx(address(erc20)).staderConfig().getStakePoolManager()
        );
        return _safeWrap(staderStakePoolManager.getExchangeRate());
    }
}
