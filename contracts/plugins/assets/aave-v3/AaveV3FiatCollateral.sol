// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "../../../libraries/Fixed.sol";
import "../AppreciatingFiatCollateral.sol";

import { StaticATokenV3LM } from "./vendor/StaticATokenV3LM.sol";

/**
 * @title AaveV3FiatCollateral
 * @notice Collateral plugin for an aToken for a UoA-pegged asset, like aUSDC or a aUSDP on Aave V3
 * Expected: {tok} != {ref}, {ref} is pegged to {target} unless defaulting, {target} == {UoA}
 */
contract AaveV3FiatCollateral is AppreciatingFiatCollateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    /// @param config.chainlinkFeed Feed units: {UoA/ref}
    /// @param revenueHiding {1} A value like 1e-6 that represents the maximum refPerTok to hide
    constructor(CollateralConfig memory config, uint192 revenueHiding)
        AppreciatingFiatCollateral(config, revenueHiding)
    {}

    /// @return {ref/tok} Actual quantity of whole reference units per whole collateral tokens
    function _underlyingRefPerTok() internal view override returns (uint192) {
        uint256 rate = StaticATokenV3LM(address(erc20)).rate(); // {ray ref/tok}

        return shiftl_toFix(rate, -27); // {ray -> wad}
    }

    /// Claim rewards earned by holding a balance of the ERC20 token
    function claimRewards() external virtual override(Asset, IRewardable) {
        // noop
    }

    /// Claim rewards, must specify rewards to be claimed
    function claimRewardsLM(address receiver, address[] memory rewards) external {
        StaticATokenV3LM(address(erc20)).claimRewards(receiver, rewards);
    }
}
