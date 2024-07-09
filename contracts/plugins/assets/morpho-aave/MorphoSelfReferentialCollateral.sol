// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;
// solhint-disable max-line-length
import { AggregatorV3Interface } from "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import { Asset, AppreciatingFiatCollateral, CollateralConfig, IRewardable } from "../AppreciatingFiatCollateral.sol";
import { MorphoTokenisedDeposit } from "./MorphoTokenisedDeposit.sol";
import { OracleLib } from "../OracleLib.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { shiftl_toFix, FIX_ONE, FLOOR, FixLib, CEIL } from "../../../libraries/Fixed.sol";

// solhint-enable max-line-length

/**
 * @title MorphoSelfReferentialCollateral
 * @notice Collateral plugin for a Morpho pool with self referential collateral, like WETH
 * Expected: {tok} != {ref}, {ref} == {target}, {target} != {UoA}
 */
contract MorphoSelfReferentialCollateral is AppreciatingFiatCollateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    MorphoTokenisedDeposit public immutable vault;
    IERC20Metadata private immutable morpho; // MORPHO token
    uint256 private immutable oneShare;
    int8 private immutable refDecimals;

    /// config.erc20 must be a MorphoTokenisedDeposit
    /// @param config.chainlinkFeed Feed units: {UoA/ref}
    /// @param revenueHiding {1} A value like 1e-6 that represents the maximum refPerTok to hide
    constructor(CollateralConfig memory config, uint192 revenueHiding)
        AppreciatingFiatCollateral(config, revenueHiding)
    {
        require(config.defaultThreshold == 0, "default threshold not supported");
        require(address(config.erc20) != address(0), "missing erc20");
        vault = MorphoTokenisedDeposit(address(config.erc20));
        morpho = IERC20Metadata(address(vault.rewardToken()));
        oneShare = 10**vault.decimals();
        refDecimals = int8(uint8(IERC20Metadata(vault.asset()).decimals()));
    }

    /// Can revert, used by other contract functions in order to catch errors
    /// Should NOT be manipulable by MEV
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
        // {UoA/tok} = {UoA/ref} * {ref/tok}
        uint192 p = chainlinkFeed.price(oracleTimeout).mul(underlyingRefPerTok());
        uint192 err = p.mul(oracleError, CEIL);

        low = p - err;
        high = p + err;
        // assert(low <= high); obviously true just by inspection

        pegPrice = targetPerRef();
    }

    /// @return {ref/tok} Actual quantity of whole reference units per whole collateral tokens
    function underlyingRefPerTok() public view override returns (uint192) {
        return shiftl_toFix(vault.convertToAssets(oneShare), -refDecimals, FLOOR);
    }

    /// Claim rewards earned by holding a balance of the ERC20 token
    /// @custom:delegate-call
    function claimRewards() external virtual override(Asset, IRewardable) {
        uint256 _bal = morpho.balanceOf(address(this));
        IRewardable(address(erc20)).claimRewards();
        emit RewardsClaimed(morpho, morpho.balanceOf(address(this)) - _bal);
    }
}
