// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "../ERC4626FiatCollateral.sol";
import "../OracleLib.sol";

/**
 * @title Origin Staked ETH Collateral for Mainnet
 * @notice Collateral plugin for Origin OETH,
 * tok = wOETH  (wrapped OETH)
 * ref = OETH
 * tar = ETH
 * UoA = USD
 */
contract OETHCollateral is ERC4626FiatCollateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    AggregatorV3Interface public immutable uoaPerTargetChainlinkFeed; // {UoA/tar}
    uint48 public immutable uoaPerTargetChainlinkTimeout; // {s}

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
        // {UoA/tar}
        // {USD/ETH}
        uint192 uoaPerTar = uoaPerTargetChainlinkFeed.price(uoaPerTargetChainlinkTimeout);

        // {tar/ref}
        // {ETH/OETH}
        pegPrice = chainlinkFeed.price(oracleTimeout);

        // {UoA/tok} = {UoA/tar} * {tar/ref} * {ref/tok}
        // USD/wOETH = USD/ETH * ETH/OETH * OETH/wOETH
        uint192 p = uoaPerTar.mul(pegPrice).mul(underlyingRefPerTok());
        uint192 err = p.mul(oracleError, CEIL);

        high = p + err;
        low = p - err;
        // assert(low <= high); obviously true just by inspection
    }
}
