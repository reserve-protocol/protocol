// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "../../../libraries/Fixed.sol";
import "../AppreciatingFiatCollateral.sol";
import "./vendor/ISUsds.sol";

/**
 * @title SUSDS Collateral
 * @notice Collateral plugin for the SSR wrapper sUSDS
 * tok = SUSDS (transferrable SSR-locked USDS)
 * ref = USDS
 * tar = USD
 * UoA = USD
 */
contract SUSDSCollateral is AppreciatingFiatCollateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    /// @param config.chainlinkFeed {UoA/ref} price of USDS in USD terms
    constructor(CollateralConfig memory config, uint192 revenueHiding)
        AppreciatingFiatCollateral(config, revenueHiding)
    {
        require(config.defaultThreshold != 0, "defaultThreshold zero");
    }

    /// Refresh exchange rates and update default status.
    /// @custom:interaction RCEI
    function refresh() public virtual override {
        // == Refresh ==
        // Update SSR
        ISUsds pot = ISUsds(address(erc20));
        if (block.timestamp > pot.rho()) pot.drip();

        // Intentional and correct for the super call to be last!
        super.refresh(); // already handles all necessary default checks
    }

    /// @return {ref/tok} Actual quantity of whole reference units per whole collateral tokens
    function underlyingRefPerTok() public view override returns (uint192) {
        return shiftl_toFix(ISUsds(address(erc20)).chi(), -27, FLOOR);
    }
}
