// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "../../../libraries/Fixed.sol";
import "../AppreciatingFiatCollateral.sol";
import "../OracleLib.sol";

interface IWSuperOETHb {
    function convertToAssets(uint256 amount) external view returns (uint256);
}

interface IMorphoChainlinkOracleV2 {
    function price() external view returns (uint256);
}

/**
 * @title Origin Staked ETH Collateral for Base L2
 * @notice Collateral plugin for Origin OETH,
 * tok = wsuperOETHb  (wrapped superOETHb)
 * ref = superOETHb (pegged to ETH 1:1)
 * tar = ETH
 * UoA = USD
 */
contract OETHCollateralL2Base is AppreciatingFiatCollateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    IMorphoChainlinkOracleV2 public immutable targetPerTokChainlinkFeed; // {tar/token}

    AggregatorV3Interface public immutable uoaPerTargetChainlinkFeed; // {UoA/tar}
    uint48 public immutable uoaPerTargetChainlinkTimeout; // {s}

    /// @param config.chainlinkFeed - ignored
    /// @param config.oracleTimeout - ignored
    /// @param config.oracleError {1} Should be the oracle error for UoA/tok
    constructor(
        CollateralConfig memory config,
        uint192 revenueHiding,
        IMorphoChainlinkOracleV2 _targetPerTokChainlinkFeed,
        AggregatorV3Interface _uoaPerTargetChainlinkFeed,
        uint48 _uoaPerTargetChainlinkTimeout
    ) AppreciatingFiatCollateral(config, revenueHiding) {
        require(config.defaultThreshold != 0, "defaultThreshold zero");

        require(address(_targetPerTokChainlinkFeed) != address(0), "targetPerTokFeed missing");
        require(address(_uoaPerTargetChainlinkFeed) != address(0), "uoaPerTargetFeed missing");

        targetPerTokChainlinkFeed = _targetPerTokChainlinkFeed;

        uoaPerTargetChainlinkFeed = _uoaPerTargetChainlinkFeed;
        uoaPerTargetChainlinkTimeout = _uoaPerTargetChainlinkTimeout;

        maxOracleTimeout = uint48(Math.max(maxOracleTimeout, _uoaPerTargetChainlinkTimeout));
    }

    /// Can revert, used by other contract functions in order to catch errors
    /// @return low {UoA/tok} The low price estimate
    /// @return high {UoA/tok} The high price estimate
    /// @return pegPrice {target/ref} The actual price observed in the peg
    function tryPrice() external view override returns (uint192 low, uint192 high, uint192 pegPrice) {
        // {tar/tok}
        // {ETH/wsuperOETHb}
        uint192 targetPerTok = _safeWrap(targetPerTokChainlinkFeed.price());

        // {UoA/tar}
        // {USD/ETH}
        uint192 uoaPerTar = uoaPerTargetChainlinkFeed.price(uoaPerTargetChainlinkTimeout);

        // {UoA/tok} = {UoA/tar} * {tar/tok}
        // USD/wsuperOETHb = USD/ETH * ETH/wsuperOETHb
        uint192 p = uoaPerTar.mul(targetPerTok);
        uint192 err = p.mul(oracleError, CEIL);

        high = p + err;
        low = p - err;
        // assert(low <= high); obviously true just by inspection

        // {tar/ref} = {tar/tok} / {ref/tok} Get current market peg
        // ETH/superOETHb = ETH/wsuperOETHb / superOETHb/wsuperOETHb
        pegPrice = targetPerTok.div(underlyingRefPerTok());
    }

    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    /// {superOETHb/wsuperOETHb}
    function underlyingRefPerTok() public view override returns (uint192) {
        return _safeWrap(IWSuperOETHb(address(erc20)).convertToAssets(FIX_ONE));
    }
}
