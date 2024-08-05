// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { CEIL, FixLib, _safeWrap } from "../../../libraries/Fixed.sol";
import { AggregatorV3Interface, OracleLib } from "../OracleLib.sol";
import { CollateralConfig, AppreciatingFiatCollateral } from "../AppreciatingFiatCollateral.sol";
import { L2LSDCollateral } from "../L2LSDCollateral.sol";

/**
 * @title CBEthCollateral
 * @notice Collateral plugin for Coinbase's staked ETH
 * tok = cbETH
 * ref = ETH2
 * tar = ETH
 * UoA = USD
 */
contract CBEthCollateralL2 is L2LSDCollateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    AggregatorV3Interface public immutable targetPerTokChainlinkFeed; // {target/tok}
    uint48 public immutable targetPerTokChainlinkTimeout;

    /// @param config.chainlinkFeed {UoA/target} price of ETH in USD terms
    /// @param _targetPerTokChainlinkFeed {target/tok} price of cbETH in ETH terms
    constructor(
        CollateralConfig memory config,
        uint192 revenueHiding,
        AggregatorV3Interface _targetPerTokChainlinkFeed,
        uint48 _targetPerTokChainlinkTimeout,
        AggregatorV3Interface _exchangeRateChainlinkFeed,
        uint48 _exchangeRateChainlinkTimeout
    )
        L2LSDCollateral(
            config,
            revenueHiding,
            _exchangeRateChainlinkFeed,
            _exchangeRateChainlinkTimeout
        )
    {
        require(address(_targetPerTokChainlinkFeed) != address(0), "missing targetPerTok feed");
        require(_targetPerTokChainlinkTimeout != 0, "targetPerTokChainlinkTimeout zero");

        targetPerTokChainlinkFeed = _targetPerTokChainlinkFeed;
        targetPerTokChainlinkTimeout = _targetPerTokChainlinkTimeout;
        maxOracleTimeout = uint48(Math.max(maxOracleTimeout, _targetPerTokChainlinkTimeout));
    }

    /// Can revert, used by other contract functions in order to catch errors
    /// Should NOT be manipulable by MEV
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
}
