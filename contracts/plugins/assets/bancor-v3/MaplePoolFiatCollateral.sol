// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import { FixLib, shiftl_toFix } from "contracts/libraries/Fixed.sol";
import { AggregatorV3Interface, OracleLib } from "contracts/plugins/assets/OracleLib.sol";
import { IRewardable, Asset, CollateralConfig, AppreciatingFiatCollateral } from "contracts/plugins/assets/AppreciatingFiatCollateral.sol";
import { IMaplePool } from "contracts/plugins/assets/maple-v2/vendor/IMaplePool.sol";

/**
 * @title MaplePoolFiatCollateral
 * @notice Collateral plugin for the token given to the liquidity providers
 * The 2 target pools  are permissionless; one holds USDC, the other wETH
 * {tok} = MPL-mcUSDC2
 * {ref} = USDc
 * {target} = USD
 * {UoA} = USD
 */
contract MaplePoolFiatCollateral is AppreciatingFiatCollateral {
    using FixLib for uint192;
    using OracleLib for AggregatorV3Interface;

    // The underlying tokens may have 18 (wETH) or 6 (USDC) decimals
    // The Maple v2 tokens have the same number of decimals than their underlying

    /// @param config.chainlinkFeed Feed units: {UoA/ref} = {target/ref}
    /// @param revenueHiding {1} A value like 1e-6 that represents the maximum refPerTok to hide
    constructor(CollateralConfig memory config, uint192 revenueHiding) AppreciatingFiatCollateral(config, revenueHiding) {}

    /// Refresh exchange rates and update default status.
    /// @custom:interaction RCEI
    function refresh() public virtual override {
        super.refresh(); // already handles all necessary default checks
    }

    /// @return {ref/tok} Actual quantity of whole reference units per whole collateral tokens
    function _underlyingRefPerTok() internal view override returns (uint192) {
        uint256 rate = IMaplePool(address(erc20)).convertToAssets(uint256(1e18));
        return shiftl_toFix(rate, -18); // convert to uint192 and actually keep the same value
    }

    /// Maple pools don't hand out rewards for LP tokens
    /// All the returns (from loan interests) are added to the LP, thus increasing the value of all the shares
    /// The MPL rewards are discontinued; they were a temporary incentive 
    function claimRewards() external virtual override(Asset, IRewardable) {}
}
