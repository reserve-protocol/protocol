// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC4626.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "../../../libraries/Fixed.sol";
import "../AppreciatingFiatCollateral.sol";
import "../OracleLib.sol";

/**
 * @title MoonwellMorphoUSDCCollateral
 * @notice Collateral plugin for the Moonwell Morpho USDC vault on Base
 *
 * Vault address: 0xc1256Ae5FF1cf2719D4937adb3bbCCab2E00A2Ca
 * Token: mwUSDC
 *
 * Units:
 * - {tok} = mwUSDC (Moonwell Morpho USDC vault share token)
 * - {ref} = USDC (underlying reference token)
 * - {target} = USD (target unit)
 * - {UoA} = USD (unit of account)
 */
contract MoonwellMorphoUSDCCollateral is AppreciatingFiatCollateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    // The Moonwell Morpho USDC vault address on Base
    address public constant VAULT = 0xc1256Ae5FF1cf2719D4937adb3bbCCab2E00A2Ca;

    IERC4626 public immutable vault;
    uint8 public immutable vaultDecimals;
    uint8 public immutable underlyingDecimals;

    /// @param config.chainlinkFeed Feed units: {UoA/ref} (USDC/USD price feed)
    constructor(CollateralConfig memory config, uint192 revenueHiding)
        AppreciatingFiatCollateral(config, revenueHiding)
    {
        require(address(config.erc20) == VAULT, "wrong vault address");
        require(config.defaultThreshold != 0, "defaultThreshold zero");
        
        vault = IERC4626(address(config.erc20));
        vaultDecimals = vault.decimals();
        underlyingDecimals = IERC20Metadata(vault.asset()).decimals();
    }

    /// @custom:delegate-call
    function claimRewards() external override(Asset, IRewardable) {
        // Moonwell Morpho vault may have rewards, but for now we'll implement as no-op
        // This can be extended if the vault has claimable rewards
        emit RewardsClaimed(IERC20(address(0)), 0);
    }

    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    function underlyingRefPerTok() public view virtual override returns (uint192) {
        // For ERC4626 vaults, use convertToAssets(1eDecimals)
        uint256 oneShare = 10 ** vaultDecimals;
        uint256 assets = vault.convertToAssets(oneShare);
        
        // Convert to Fix format with proper decimal handling
        return shiftl_toFix(assets, -int8(underlyingDecimals));
    }
} 