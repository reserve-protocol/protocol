// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "../../../libraries/Fixed.sol";
import "../AppreciatingFiatCollateral.sol";
import "../OracleLib.sol";
import "./IReth.sol";

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
        pegPrice = targetPerRef(); // {target/ref} ETH/ETH is always 1

        // {UoA/ref}
        uint192 p = chainlinkFeed.price(oracleTimeout); // target==ref :: {UoA/target} == {UoA/ref}

        // {ref/tok}
        uint192 refPerTok = refPerTokChainlinkFeed.price(refPerTokChainlinkTimeout);

        // {UoA/tok} = {UoA/ref} * {ref/tok}
        high = p.mul(refPerTok);
        low = p.mul(refPerTok.mul(revenueShowing));

        high = high + high.mul(oracleError);
        low = low - low.mul(oracleError);
    }

    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    function _underlyingRefPerTok() internal view override returns (uint192) {
        return _safeWrap(IReth(address(erc20)).getExchangeRate());
    }
}
