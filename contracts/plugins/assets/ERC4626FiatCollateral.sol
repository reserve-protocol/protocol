// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

// solhint-disable-next-line max-line-length
import { Asset, AppreciatingFiatCollateral, CollateralConfig, IRewardable } from "./AppreciatingFiatCollateral.sol";
import { OracleLib } from "./OracleLib.sol";
// solhint-disable-next-line max-line-length
import { AggregatorV3Interface } from "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import { IERC4626 } from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { FLOOR, shiftl_toFix } from "../../libraries/Fixed.sol";

/**
 * @title ERC4626FiatCollateral
 * @notice Collateral plugin for a ERC4626 vault
 *
 * Warning: Only valid for linear ERC4626 vaults
 */
contract ERC4626FiatCollateral is AppreciatingFiatCollateral {
    uint256 private immutable oneShare;
    int8 private immutable refDecimals;

    /// config.erc20 must be a MetaMorpho ERC4626 vault
    /// @param config.chainlinkFeed Feed units: {UoA/ref}
    /// @param revenueHiding {1} A value like 1e-6 that represents the maximum refPerTok to hide
    constructor(CollateralConfig memory config, uint192 revenueHiding)
        AppreciatingFiatCollateral(config, revenueHiding)
    {
        IERC4626 vault = IERC4626(address(config.erc20));
        oneShare = 10**vault.decimals();
        refDecimals = int8(uint8(IERC20Metadata(vault.asset()).decimals()));
    }

    /// @return {ref/tok} Actual quantity of whole reference units per whole collateral tokens
    function underlyingRefPerTok() public view override returns (uint192) {
        // already accounts for fees to be taken out -- FLOOR
        return
            shiftl_toFix(IERC4626(address(erc20)).convertToAssets(oneShare), -refDecimals, FLOOR);
    }
}
