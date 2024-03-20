// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

// solhint-disable-next-line max-line-length
import { Asset, AppreciatingFiatCollateral, CollateralConfig, IRewardable } from "../AppreciatingFiatCollateral.sol";
import { OracleLib } from "../OracleLib.sol";
// solhint-disable-next-line max-line-length
import { AggregatorV3Interface } from "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { divuu } from "../../../libraries/Fixed.sol";
import { IMetaMorpho } from "./IMetaMorpho.sol";

uint256 constant WAD = 1e18;

/**
 * @title MetaMorphoFiatCollateral
 * @notice Collateral plugin for a MetaMorpho vault. Does not handle reward claiming.
 *
 * Supports MetaMorpho ERC4626 vaults from factory 0xa9c3d3a366466fa809d1ae982fb2c46e5fc41101
 */
abstract contract MetaMorphoCollateral is AppreciatingFiatCollateral {
    using OracleLib for AggregatorV3Interface;

    uint256 private immutable oneShare;
    int8 private immutable refDecimals;
    uint256 private immutable sharePerAsset; // {qTok/qRef}

    /// config.erc20 must be a MetaMorpho ERC4626 vault
    /// @param config.chainlinkFeed Feed units: {UoA/ref}
    /// @param revenueHiding {1} A value like 1e-6 that represents the maximum refPerTok to hide
    constructor(CollateralConfig memory config, uint192 revenueHiding)
        AppreciatingFiatCollateral(config, revenueHiding)
    {
        require(address(config.erc20) != address(0), "missing erc20");
        IMetaMorpho vault = IMetaMorpho(address(config.erc20));
        oneShare = 10**vault.decimals();
        refDecimals = int8(uint8(IERC20Metadata(vault.asset()).decimals()));
        sharePerAsset = 10**vault.DECIMALS_OFFSET();
    }

    /// @return {ref/tok} Actual quantity of whole reference units per whole collateral tokens
    function underlyingRefPerTok() public view override returns (uint192) {
        // Approach: Build fees into our measure of refPerTok to prevent downturns after fee claim

        // {qTok}, {qRef}
        (uint256 feeShares, uint256 newTotalAssets) = _getAccruedFeeShares();

        // {qTok}
        uint256 newTotalShares = IMetaMorpho(address(erc20)).totalSupply() + feeShares;
        return divuu(sharePerAsset * newTotalAssets, newTotalShares);
    }

    // Rewards happen via off-chain proofs

    // === Internal ===

    /// Compute how many new shares _would_ minted if fees were extracted, as well as totalAssets()
    /// @dev Computes and returns the fee shares (`feeShares`) to mint and the new vault's total assets
    /// @return feeShares {qTok}
    /// @return newTotalAssets {qRef}
    function _getAccruedFeeShares()
        internal
        view
        returns (uint256 feeShares, uint256 newTotalAssets)
    {
        // This function modeled after vault internal function `_accruedFeeShares()`

        IMetaMorpho vault = IMetaMorpho(address(erc20));
        newTotalAssets = vault.totalAssets(); // {qRef}
        uint256 lastTotalAssets = vault.lastTotalAssets(); // {qRef}

        uint256 totalInterest = newTotalAssets > lastTotalAssets
            ? newTotalAssets - lastTotalAssets
            : 0; // {qRef}

        if (totalInterest != 0) {
            uint96 fee = vault.fee();
            if (fee != 0) {
                // It is acknowledged that `feeAssets` may be rounded down to 0 if `totalInterest * fee < WAD`.
                uint256 feeAssets = (totalInterest * fee) / WAD; // {qRef}
                newTotalAssets = newTotalAssets - feeAssets; // {qRef}

                // The fee assets is subtracted from the total assets in this calculation to compensate for the fact
                // that total assets is already increased by the total interest (including the fee assets).
                feeShares =
                    (feeAssets * (vault.totalSupply() + sharePerAsset)) /
                    (newTotalAssets + 1); // {qTok}
            }
        }
    }
}
