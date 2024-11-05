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

    // solhint-disable no-empty-blocks
    /// @param config.chainlinkFeed Feed units: {UoA/ref}
    /// @param revenueHiding {1} A value like 1e-6 that represents the maximum refPerTok to hide
    constructor(CollateralConfig memory config, uint192 revenueHiding)
        AppreciatingFiatCollateral(config, revenueHiding)
    {
        require(config.defaultThreshold != 0, "defaultThreshold zero");
    }

    // solhint-enable no-empty-blocks

    /// @return {ref/tok} Actual quantity of whole reference units per whole collateral tokens
    function underlyingRefPerTok() public view override returns (uint192) {
        uint256 rate = StaticATokenV3LM(address(erc20)).rate(); // {ray ref/tok}

        return shiftl_toFix(rate, -27, FLOOR); // {ray -> wad}
    }

    /// Claim rewards earned by holding a balance of the ERC20 token
    /// @custom:delegate-call
    function claimRewards() external virtual override(Asset, IRewardable) {
        StaticATokenV3LM erc20_ = StaticATokenV3LM(address(erc20));
        address[] memory rewardsList = erc20_.INCENTIVES_CONTROLLER().getRewardsList();
        uint256[] memory bals = new uint256[](rewardsList.length);

        uint256 len = rewardsList.length;
        for (uint256 i = 0; i < len; i++) {
            bals[i] = IERC20(rewardsList[i]).balanceOf(address(this));
        }

        IRewardable(address(erc20)).claimRewards();

        for (uint256 i = 0; i < len; i++) {
            emit RewardsClaimed(
                IERC20(rewardsList[i]),
                IERC20(rewardsList[i]).balanceOf(address(this)) - bals[i]
            );
        }
    }
}
