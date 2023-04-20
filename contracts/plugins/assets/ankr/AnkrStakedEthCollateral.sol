// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "../../../libraries/Fixed.sol";
import "../AppreciatingCollateral.sol";
import "../OracleLib.sol";
import "./IAnkrETH.sol";

/**
 * @title Ankr Staked Eth Collateral
 * @notice Collateral plugin for Ankr ankrETH,
 * tok = ankrETH
 * ref = ETH
 * tar = ETH
 * UoA = USD
 */
contract AnkrStakedEthCollateral is AppreciatingCollateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    // solhint-disable no-empty-blocks
    /// @param config.chainlinkFeed Feed units: {UoA/ref}
    constructor(CollateralConfig memory config, uint192 revenueHiding)
        AppreciatingCollateral(config, revenueHiding)
    {}

    // solhint-enable no-empty-blocks

    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    function _underlyingRefPerTok() internal view override returns (uint192) {
        uint256 rate = IAnkrETH(address(erc20)).ratio();
        return FIX_ONE.div(_safeWrap(rate), FLOOR);
    }
}
