// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "../../../libraries/Fixed.sol";
import "../AppreciatingFiatCollateral.sol";
import "../OracleLib.sol";
import "../FraxOracleLib.sol";
import "./vendor/IsfrxEth.sol";

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

    FraxAggregatorV3Interface public immutable targetPerRefChainlinkFeed; // {target/tok}
    uint48 public immutable targetPerRefChainlinkTimeout;

    /// @param config.chainlinkFeed {UoA/target} price of ETH in USD terms
    /// @param _targetPerRefChainlinkFeed {target/tok} price of frxETH in ETH terms
    constructor(
        CollateralConfig memory config,
        uint192 revenueHiding,
        FraxAggregatorV3Interface _targetPerRefChainlinkFeed,
        uint48 _targetPerRefChainlinkTimeout
    ) AppreciatingFiatCollateral(config, revenueHiding) {
        require(config.defaultThreshold > 0, "defaultThreshold zero");
        require(address(_targetPerRefChainlinkFeed) != address(0), "missing targetPerRef feed");
        require(_targetPerRefChainlinkTimeout != 0, "targetPerRefChainlinkTimeout zero");

        targetPerRefChainlinkFeed = _targetPerRefChainlinkFeed;
        targetPerRefChainlinkTimeout = _targetPerRefChainlinkTimeout;
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
        // {target/ref} Get current market peg ({eth/sfrxeth})
        pegPrice = targetPerRefChainlinkFeed.price(targetPerRefChainlinkTimeout);

        // {UoA/tok} = {UoA/target} * {target/ref} * {ref/tok}
        uint192 p = chainlinkFeed.price(oracleTimeout).mul(pegPrice).mul(_underlyingRefPerTok());
        uint192 err = p.mul(oracleError, CEIL);

        high = p + err;
        low = p - err;
        // assert(low <= high); obviously true just by inspection
    }

    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    function _underlyingRefPerTok() internal view override returns (uint192) {
        return _safeWrap(IsfrxEth(address(erc20)).pricePerShare());
    }
}
