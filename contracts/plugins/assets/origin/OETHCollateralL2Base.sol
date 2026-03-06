// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.28;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "../../../libraries/Fixed.sol";
import "../ERC4626FiatCollateral.sol";
import "../OracleLib.sol";

interface IMorphoChainlinkOracleV2 {
    function price() external view returns (uint256);
}

/**
 * *************************************************************************************
 * WARNING: This plugin assumes a peg price of `1 superOETH = 1 ETH`. This implies that
 * depeg checks will not be performed and that the plugin might be priced incorrectly if
 * this assumption breaks. Use with caution, understanding the risks and limitations.
 * *************************************************************************************
 */

/**
 * @title Origin Staked ETH Collateral for Base L2
 * @notice Collateral plugin for Origin OETH,
 * tok = wsuperOETHb  (wrapped superOETHb)
 * ref = superOETHb (pegged to ETH 1:1)
 * tar = ETH
 * UoA = USD
 */
contract OETHCollateralL2Base is ERC4626FiatCollateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    AggregatorV3Interface public immutable uoaPerTargetChainlinkFeed; // {UoA/tar}
    uint48 public immutable uoaPerTargetChainlinkTimeout; // {s}

    /// @param config.chainlinkFeed - ignored
    /// @param config.oracleTimeout - ignored
    constructor(
        CollateralConfig memory config,
        uint192 revenueHiding,
        AggregatorV3Interface _uoaPerTargetChainlinkFeed,
        uint48 _uoaPerTargetChainlinkTimeout
    ) ERC4626FiatCollateral(config, revenueHiding) {
        require(address(_uoaPerTargetChainlinkFeed) != address(0), "uoaPerTargetFeed missing");
        require(_uoaPerTargetChainlinkTimeout != 0, "uoaPerTargetChainlinkTimeout zero");

        uoaPerTargetChainlinkFeed = _uoaPerTargetChainlinkFeed;
        uoaPerTargetChainlinkTimeout = _uoaPerTargetChainlinkTimeout;

        maxOracleTimeout = uint48(Math.max(maxOracleTimeout, _uoaPerTargetChainlinkTimeout));
    }

    /// Can revert, used by other contract functions in order to catch errors
    /// @return low {UoA/tok} The low price estimate
    /// @return high {UoA/tok} The high price estimate
    /// @return pegPrice {target/ref} Assumes pegPrice = 1 (FIX_ONE)
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
        // {UoA/tar}
        // {USD/ETH}
        uint192 uoaPerTar = uoaPerTargetChainlinkFeed.price(uoaPerTargetChainlinkTimeout);

        // {UoA/tok} = {UoA/tar} * {tar/tok}
        // USD/wsuperOETHb = USD/ETH * ETH/wsuperOETHb (assuming 1 ETH = 1 superOETHb)
        uint192 p = uoaPerTar.mul(underlyingRefPerTok());
        uint192 err = p.mul(oracleError, CEIL);

        high = p + err;
        low = p - err;
        // assert(low <= high); obviously true just by inspection

        // {tar/ref} = {tar/tok} / {ref/tok} Get current market peg
        // ETH/superOETHb = ETH/wsuperOETHb / superOETHb/wsuperOETHb
        pegPrice = FIX_ONE;
    }
}
