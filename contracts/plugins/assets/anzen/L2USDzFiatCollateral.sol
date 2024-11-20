// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "../../../libraries/Fixed.sol";
import "../AppreciatingFiatCollateral.sol";
import "../OracleLib.sol";

/**
 * @title USDz Fiat Collateral for L2s (like Base)
 * @notice Collateral plugin for USDz (Anzen Finance)
 * tok = sUSDz  (wrapped USDz, ERC4626 vault on Ethereum Mainnet)
 * ref = USDz
 * tar = USD
 * UoA = USD
 */

contract L2USDzFiatCollateral is AppreciatingFiatCollateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    // Here we include them directly and ignore the parent class' chainlinkFeed entirely.

    AggregatorV3Interface public immutable targetPerRefChainlinkFeed; // {tar/ref}
    uint48 public immutable targetPerRefChainlinkTimeout; // {s}

    AggregatorV3Interface public immutable refPerTokenChainlinkFeed; // {ref/tok}
    uint48 public immutable refPerTokenChainlinkTimeout; // {s}

    /// @param config.chainlinkFeed - ignored
    /// @param config.oracleTimeout - ignored
    /// @param config.oracleError {1} Should be the oracle error for UoA/tok
    constructor(
        CollateralConfig memory config,
        uint192 revenueHiding,
        AggregatorV3Interface _targetPerRefChainlinkFeed,
        uint48 _targetPerRefChainlinkTimeout,
        AggregatorV3Interface _refPerTokenChainlinkFeed,
        uint48 _refPerTokenChainlinkTimeout
    ) AppreciatingFiatCollateral(config, revenueHiding) {
        require(config.defaultThreshold != 0, "defaultThreshold zero");

        require(address(_targetPerRefChainlinkFeed) != address(0), "targetPerRefFeed missing");
        require(_targetPerRefChainlinkTimeout != 0, "targetPerRefTimeout zero");
        require(address(_refPerTokenChainlinkFeed) != address(0), "refPerTokenFeed missing");
        require(_refPerTokenChainlinkTimeout != 0, "refPerTokenTimeout zero");

        targetPerRefChainlinkFeed = _targetPerRefChainlinkFeed;
        targetPerRefChainlinkTimeout = _targetPerRefChainlinkTimeout;

        refPerTokenChainlinkFeed = _refPerTokenChainlinkFeed;
        refPerTokenChainlinkTimeout = _refPerTokenChainlinkTimeout;
        maxOracleTimeout = uint48(
            Math.max(
                Math.max(maxOracleTimeout, _targetPerRefChainlinkTimeout),
                Math.max(maxOracleTimeout, _refPerTokenChainlinkTimeout)
            )
        );
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
        // {tar/ref} Get current market peg ({eth/steth})
        pegPrice = targetPerRefChainlinkFeed.price(targetPerRefChainlinkTimeout);

        // {UoA/tok} = {tar/ref} * {ref/tok}
        uint192 p = pegPrice.mul(underlyingRefPerTok());
        uint192 err = p.mul(oracleError, CEIL);

        high = p + err;
        low = p - err;
        // assert(low <= high); obviously true just by inspection
    }

    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    function underlyingRefPerTok() public view override returns (uint192) {
        return refPerTokenChainlinkFeed.price(refPerTokenChainlinkTimeout);
    }
}