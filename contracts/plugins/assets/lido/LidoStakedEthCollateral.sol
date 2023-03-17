// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "../../../libraries/Fixed.sol";
import "../AppreciatingFiatCollateral.sol";
import "../OracleLib.sol";
import "./IWSTETH.sol";

/**
 * @title Lido Staked Eth Collateral
 * @notice Collateral plugin for Lido stETH,
 * tok = wstETH  (wrapped stETH)
 * ref = stETH (pegged to ETH 1:1)
 * tar = ETH
 * UoA = USD
 */
contract LidoStakedEthCollateral is AppreciatingFiatCollateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    AggregatorV3Interface public immutable targetPerRefChainlinkFeed; // {ref/tok}
    uint48 public immutable targetPerRefChainlinkTimeout; // {s}

    constructor(
        CollateralConfig memory config,
        uint192 revenueHiding,
        AggregatorV3Interface _targetPerRefChainlinkFeed,
        uint48 _targetPerRefChainlinkTimeout
    ) AppreciatingFiatCollateral(config, revenueHiding) {
        require(address(_targetPerRefChainlinkFeed) != address(0), "missing targetPerRef feed");
        require(_targetPerRefChainlinkTimeout > 0, "targetPerRefChainlinkTimeout zero");
        targetPerRefChainlinkFeed = _targetPerRefChainlinkFeed;
        targetPerRefChainlinkTimeout = _targetPerRefChainlinkTimeout;
        exposedReferencePrice = _underlyingRefPerTok().mul(revenueShowing);
    }

    /// Can revert, used by other contract functions in order to catch errors
    /// @return low {UoA/tok} The low price estimate
    /// @return high {UoA/tok} The high price estimate
    /// @return pegPrice {target/ref}
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
        // {UoA/target}
        uint192 pricePerTarget = chainlinkFeed.price(oracleTimeout);

        // Get current market peg {eth/steth}, but the intended {target/ref} will be returned
        pegPrice = targetPerRefChainlinkFeed.price(targetPerRefChainlinkTimeout); // {target/ref}

        // {UoA/tok} = {UoA/target} * {target/ref} * {ref/tok}
        uint192 pLow = pricePerTarget.mul(pegPrice).mul(refPerTok());
        uint192 pHigh = pricePerTarget.mul(pegPrice).mul(_underlyingRefPerTok());

        low = pLow - pLow.mul(oracleError);
        high = pHigh + pHigh.mul(oracleError);
    }

    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    function _underlyingRefPerTok() internal view override returns (uint192) {
        uint256 rate = IWSTETH(address(erc20)).stEthPerToken();
        return _safeWrap(rate);
    }
}
