// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "../../../libraries/Fixed.sol";
import "../AppreciatingFiatCollateral.sol";

/// MakerDAO Pot
interface IPot {
    function rho() external returns (uint256);

    function drip() external returns (uint256);

    /// {ray}
    function chi() external view returns (uint256);
}

/**
 * @title SDAI Collateral
 * @notice Collateral plugin for the DSR wrapper sDAI
 * tok = SDAI (transferrable DSR-locked DAI)
 * ref = DAI
 * tar = USD
 * UoA = USD
 */
contract SDaiCollateral is AppreciatingFiatCollateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    IPot public immutable pot;

    /// @param config.chainlinkFeed {UoA/ref} price of DAI in USD terms
    constructor(
        CollateralConfig memory config,
        uint192 revenueHiding,
        IPot _pot
    ) AppreciatingFiatCollateral(config, revenueHiding) {
        require(config.defaultThreshold != 0, "defaultThreshold zero");
        pot = _pot;
    }

    /// Refresh exchange rates and update default status.
    /// @custom:interaction RCEI
    function refresh() public virtual override {
        // == Refresh ==
        // Update the DSR contract

        if (block.timestamp > pot.rho()) pot.drip();

        // Intentional and correct for the super call to be last!
        super.refresh(); // already handles all necessary default checks
    }

    /// @return {ref/tok} Actual quantity of whole reference units per whole collateral tokens
    function underlyingRefPerTok() public view override returns (uint192) {
        return shiftl_toFix(pot.chi(), -27, FLOOR);
    }
}
