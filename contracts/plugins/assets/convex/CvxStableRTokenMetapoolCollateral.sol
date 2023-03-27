// SPDX-License-Identifier: ISC
pragma solidity 0.8.17;

import "../../../interfaces/IRTokenOracle.sol";
import "./CvxStableMetapoolCollateral.sol";

/**
 * @title CvxStableRTokenMetapoolCollateral
 *  This plugin contract is intended for 2-token stable metapools that
 *  involve RTokens, such as eUSD-fraxBP.
 */
contract CvxStableRTokenMetapoolCollateral is CvxStableMetapoolCollateral {
    using FixLib for uint192;

    IRTokenOracle public immutable rTokenOracle;

    /// @dev config.chainlinkFeed/oracleError/oracleTimeout are unused; set chainlinkFeed to 0x1
    /// @dev config.erc20 should be a IConvexStakingWrapper
    constructor(
        CollateralConfig memory config,
        uint192 revenueHiding,
        PTConfiguration memory ptConfig,
        ICurveMetaPool metapool_,
        IRTokenOracle rTokenOracle_
    ) CvxStableMetapoolCollateral(config, revenueHiding, ptConfig, metapool_) {
        require(address(rTokenOracle_) != address(0), "rTokenOracle missing");
        rTokenOracle = rTokenOracle_;
    }

    /// Can revert, used by other contract functions in order to catch errors
    /// Should not return FIX_MAX for low
    /// Should only return FIX_MAX for high if low is 0
    /// @dev Override this when pricing is more complicated than just a single oracle
    /// @return low {UoA/tok} The low price estimate
    /// @return high {UoA/tok} The high price estimate
    /// @return {target/ref} Unused. Always 0.
    function tryPrice()
        external
        view
        virtual
        override
        returns (
            uint192 low,
            uint192 high,
            uint192
        )
    {
        // Should include revenue hiding discount in the low discount but not high

        // {UoA/pairedTok}
        (Price memory price, uint48 savedAt) = rTokenOracle.priceView(
            IRToken(address(pairedToken))
        );
        require(block.timestamp - savedAt <= rTokenOracle.cacheTimeout(), "call refresh()");

        // {UoA}
        (uint192 aumLow, uint192 aumHigh) = totalBalancesValue(price.low, price.high);

        // discount aumLow by the amount of revenue being hidden
        // {UoA} = {UoA} * {1}
        aumLow = aumLow.mul(revenueShowing);

        // {tok}
        uint192 supply = shiftl_toFix(metapool.totalSupply(), -int8(metapool.decimals()));
        // We can always assume that the total supply is non-zero

        // {UoA/tok} = {UoA} / {tok}
        low = aumLow.div(supply);
        high = aumHigh.div(supply);
        return (low, high, 0);
    }

    /// Should not revert
    /// Refresh exchange rates and update default status.
    /// Have to override to add custom default checks
    function refresh() public virtual override {
        rTokenOracle.price(IRToken(address(pairedToken)), false); // refresh price in oracle
        super.refresh();
    }
}
