// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import { FixLib, shiftl_toFix, CEIL } from "contracts/libraries/Fixed.sol";
import { AggregatorV3Interface, OracleLib } from "contracts/plugins/assets/OracleLib.sol";
import { CollateralConfig, MaplePoolFiatCollateral } from "contracts/plugins/assets/maple-v2/MaplePoolFiatCollateral.sol";
import { IMaplePool } from "contracts/plugins/assets/maple-v2/vendor/IMaplePool.sol";

/**
 * @title MaplePoolFiatCollateral
 * @notice Collateral plugin for the token given to the liquidity providers
 * The 2 target pools  are permissionless; one holds USDC, the other wETH
 * {tok} = MPL-mcWETH1
 * {ref} = wETH
 * {target} = ETH
 * {UoA} = USD
 */
contract MaplePoolNonFiatCollateral is MaplePoolFiatCollateral {
    using FixLib for uint192;
    using OracleLib for AggregatorV3Interface;

    AggregatorV3Interface public immutable uoaPerTargetChainlinkFeed; // {UoA/target}
    uint48 public immutable uoaPerTargetOracleTimeout; // {s}
    bool constantTargetPerRef; // whether or not to use the Chainlink feed for {target/ref}

    // The underlying tokens may have 18 (wETH) or 6 (USDC) decimals
    // The Maple v2 tokens have the same number of decimals than their underlying

    /// @param config.chainlinkFeed Feed units: {UoA/ref}
    /// @param uoaPerTargetChainlinkFeed_ Feed units: {UoA/target}
    /// @param uoaPerTargetOracleTimeout_ {s} oracle timeout to use for uoaPerTargetChainlinkFeed
    /// @param revenueHiding {1} A value like 1e-6 that represents the maximum refPerTok to hide
    /// @param constantTargetPerRef_ {1} true / false, in case the {target/ref} is actually constant, like {ETH/wETH}
    constructor(
        CollateralConfig memory config,
        AggregatorV3Interface uoaPerTargetChainlinkFeed_,
        uint48 uoaPerTargetOracleTimeout_,
        uint192 revenueHiding,
        bool constantTargetPerRef_
    ) MaplePoolFiatCollateral(config, revenueHiding) {
        require(address(uoaPerTargetChainlinkFeed_) != address(0), "missing uoaPerTarget feed");
        require(uoaPerTargetOracleTimeout_ > 0, "uoaPerTargetOracleTimeout cannot be 0");
        uoaPerTargetChainlinkFeed = uoaPerTargetChainlinkFeed_;
        uoaPerTargetOracleTimeout = uoaPerTargetOracleTimeout_;
        constantTargetPerRef = constantTargetPerRef_;
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
        pegPrice = targetPerRef(); // 1 (FIX_ONE)
        
        if (constantTargetPerRef == false) { // bypass the oracle for {ETH/wETH}, which is constant = 1
            chainlinkFeed.price(oracleTimeout); // {target/ref}
        }

        // {UoA/tok} = {UoA/target} * {target/ref} * {ref/tok}
        uint192 p = uoaPerTargetChainlinkFeed.price(uoaPerTargetOracleTimeout).mul(pegPrice).mul(
            _underlyingRefPerTok()
        );
        uint192 err = p.mul(oracleError, CEIL);

        low = p - err;
        high = p + err;
        // assert(low <= high); obviously true just by inspection
    }
}
