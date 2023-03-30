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

    // In order to provide tighter price estimates this contract uses {UoA/tok} and {ref/target}
    // price feeds. Here we include them directly and ignore the parent class' chainlinkFeed.

    AggregatorV3Interface public immutable targetPerRefChainlinkFeed; // {target/ref}
    uint48 public immutable targetPerRefChainlinkTimeout; // {s}

    /// @param config.chainlinkFeed {UoA/ref}
    /// @param config.oracleError {1} Should be the oracle error _only_ for the {UoA/tok} feed
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
        // {UoA/ref}
        uint192 p = chainlinkFeed.price(oracleTimeout);

        // {target/ref} Get current market peg ({eth/steth})
        pegPrice = targetPerRefChainlinkFeed.price(targetPerRefChainlinkTimeout);

        uint192 refPerTok = _underlyingRefPerTok();
        
        // {UoA/tok} = {UoA/ref} * {ref/tok}
        uint192 pHigh = p.mul(refPerTok);
        uint192 pLow = p.mul(refPerTok.mul(revenueShowing));

        high = pHigh + pHigh.mul(oracleError);
        low = pLow - pLow.mul(oracleError);
    }

    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    function _underlyingRefPerTok() internal view override returns (uint192) {
        uint256 rate = IWSTETH(address(erc20)).stEthPerToken();
        return _safeWrap(rate);
    }
}
