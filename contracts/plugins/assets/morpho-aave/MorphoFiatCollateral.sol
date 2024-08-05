// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

// solhint-disable-next-line max-line-length
import { Asset, AppreciatingFiatCollateral, CollateralConfig, IRewardable } from "../AppreciatingFiatCollateral.sol";
import { MorphoTokenisedDeposit } from "./MorphoTokenisedDeposit.sol";
import { OracleLib } from "../OracleLib.sol";
// solhint-disable-next-line max-line-length
import { AggregatorV3Interface } from "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { shiftl_toFix, FIX_ONE, FLOOR } from "../../../libraries/Fixed.sol";

/**
 * @title MorphoFiatCollateral
 * @notice Collateral plugin for a Morpho pool with fiat collateral, like USDC or USDT
 * Expected: {tok} != {ref}, {ref} is pegged to {target} unless defaulting, {target} == {UoA}
 */
contract MorphoFiatCollateral is AppreciatingFiatCollateral {
    using OracleLib for AggregatorV3Interface;

    IERC20Metadata private immutable morpho; // MORPHO token
    uint256 private immutable oneShare;
    int8 private immutable refDecimals;

    /// config.erc20 must be a MorphoTokenisedDeposit
    /// @param config.chainlinkFeed Feed units: {UoA/ref}
    /// @param revenueHiding {1} A value like 1e-6 that represents the maximum refPerTok to hide
    constructor(CollateralConfig memory config, uint192 revenueHiding)
        AppreciatingFiatCollateral(config, revenueHiding)
    {
        require(address(config.erc20) != address(0), "missing erc20");
        require(config.defaultThreshold != 0, "defaultThreshold zero");
        MorphoTokenisedDeposit vault = MorphoTokenisedDeposit(address(config.erc20));
        morpho = IERC20Metadata(address(vault.rewardToken()));
        oneShare = 10**vault.decimals();
        refDecimals = int8(uint8(IERC20Metadata(vault.asset()).decimals()));
    }

    /// @return {ref/tok} Actual quantity of whole reference units per whole collateral tokens
    function underlyingRefPerTok() public view override returns (uint192) {
        return
            shiftl_toFix(
                MorphoTokenisedDeposit(address(erc20)).convertToAssets(oneShare),
                -refDecimals,
                FLOOR
            );
    }

    /// Claim rewards earned by holding a balance of the ERC20 token
    /// @custom:delegate-call
    function claimRewards() external virtual override(Asset, IRewardable) {
        uint256 _bal = morpho.balanceOf(address(this));
        IRewardable(address(erc20)).claimRewards();
        emit RewardsClaimed(morpho, morpho.balanceOf(address(this)) - _bal);
    }
}
