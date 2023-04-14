// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import { FixLib, shiftl_toFix, CEIL } from "contracts/libraries/Fixed.sol";
import { AggregatorV3Interface, OracleLib } from "contracts/plugins/assets/OracleLib.sol";
import { CollateralConfig, BnTokenFiatCollateral } from "contracts/plugins/assets/maple-v2/BnTokenFiatCollateral.sol";
import { IPoolCollection } from "contracts/plugins/assets/bancor-v3/vendor/IPoolCollection.sol";

/**
 * @title BnTokenNonFiatCollateral
 * @notice Collateral plugin for the token given to the liquidity providers
 * {tok} = bnXYZ
 * {ref} = XYZ, any non-fiat token
 * {target} = XYZ
 * {UoA} = USD
 */
contract BnTokenNonFiatCollateral is BnTokenFiatCollateral {
    using FixLib for uint192;
    using OracleLib for AggregatorV3Interface;

    AggregatorV3Interface public immutable uoaPerTargetChainlinkFeed; // {UoA/target}
    uint48 public immutable uoaPerTargetOracleTimeout; // {s}

    // The underlying tokens may have 18 (wETH) or 6 (USDC) decimals
    // The Maple v2 tokens have the same number of decimals than their underlying

    /// @param config.chainlinkFeed Feed units: {UoA/ref}
    /// @param poolCollection_ The address of the collection corresponding to the pool
    /// @param uoaPerTargetChainlinkFeed_ Feed units: {UoA/target}
    /// @param uoaPerTargetOracleTimeout_ {s} oracle timeout to use for uoaPerTargetChainlinkFeed
    /// @param revenueHiding {1} A value like 1e-6 that represents the maximum refPerTok to hide
    constructor(
        CollateralConfig memory config,
        IPoolCollection poolCollection_,
        AggregatorV3Interface uoaPerTargetChainlinkFeed_,
        uint48 uoaPerTargetOracleTimeout_,
        uint192 revenueHiding
    ) BnTokenFiatCollateral(config, poolCollection_, revenueHiding) {
        require(address(uoaPerTargetChainlinkFeed_) != address(0), "missing uoaPerTarget feed");
        require(uoaPerTargetOracleTimeout_ > 0, "uoaPerTargetOracleTimeout cannot be 0");
        uoaPerTargetChainlinkFeed = uoaPerTargetChainlinkFeed_;
        uoaPerTargetOracleTimeout = uoaPerTargetOracleTimeout_;
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
        pegPrice = chainlinkFeed.price(oracleTimeout); // {target/ref}

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
