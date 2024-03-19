// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

// solhint-disable-next-line max-line-length
import { Asset, AppreciatingFiatCollateral, CollateralConfig, IRewardable } from "../AppreciatingFiatCollateral.sol";
import { OracleLib } from "../OracleLib.sol";
// solhint-disable-next-line max-line-length
import { AggregatorV3Interface } from "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { shiftl_toFix, FIX_ONE } from "../../../libraries/Fixed.sol";
import { IERC4626 } from "../../../vendor/oz/IERC4626.sol";

/**
 * @title MetaMorphoFiatCollateral
 * @notice Collateral plugin for a MetaMorpho vault with fiat collateral, like USDC or USDT
 * Expected: {tok} != {ref}, {ref} is pegged to {target} unless defaulting, {target} == {UoA}
 *
 * Supports MetaMorpho ERC4626 vaults from factory 0xa9c3d3a366466fa809d1ae982fb2c46e5fc41101
 */
contract MetaMorphoFiatCollateral is AppreciatingFiatCollateral {
    using OracleLib for AggregatorV3Interface;

    uint256 private immutable oneShare;
    int8 private immutable refDecimals;

    /// config.erc20 must be a MetaMorpho ERC4626 vault
    /// @param config.chainlinkFeed Feed units: {UoA/ref}
    /// @param revenueHiding {1} A value like 1e-6 that represents the maximum refPerTok to hide
    constructor(CollateralConfig memory config, uint192 revenueHiding)
        AppreciatingFiatCollateral(config, revenueHiding)
    {
        require(address(config.erc20) != address(0), "missing erc20");
        require(config.defaultThreshold > 0, "defaultThreshold zero");
        IERC4626 vault = IERC4626(address(config.erc20));
        oneShare = 10**vault.decimals();
        refDecimals = int8(uint8(IERC20Metadata(vault.asset()).decimals()));
    }

    /// @return {ref/tok} Actual quantity of whole reference units per whole collateral tokens
    function underlyingRefPerTok() public view override returns (uint192) {
        return shiftl_toFix(IERC4626(address(erc20)).convertToAssets(oneShare), -refDecimals);
    }

    // Rewards happen via off-chain proofs
}
