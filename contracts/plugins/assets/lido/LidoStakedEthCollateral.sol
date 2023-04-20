// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "../../../libraries/Fixed.sol";
import "../AppreciatingCollateral.sol";
import "../OracleLib.sol";
import "./IWSTETH.sol";

/**
 * @title Lido Staked Eth Collateral
 * @notice Collateral plugin for Lido stETH,
 * tok = wstETH  (wrapped stETH)
 * ref = stETH (pegged to ETH 1:1)
 * tar = ETH
 * UoA = USD
 */
contract LidoStakedEthCollateral is AppreciatingCollateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    // In order to provide tighter price estimates this contract uses {UoA/tok} and {ref/target}
    // price feeds. Here we include them directly and ignore the parent class' chainlinkFeed.

    // solhint-disable no-empty-blocks
    /// @param config.chainlinkFeed {UoA/ref}
    /// @param config.oracleError {1} Should be the oracle error _only_ for the {UoA/tok} feed
    constructor(
        CollateralConfig memory config,
        uint192 revenueHiding
    ) AppreciatingCollateral(config, revenueHiding) {}

    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    function _underlyingRefPerTok() internal view override returns (uint192) {
        uint256 rate = IWSTETH(address(erc20)).stEthPerToken();
        return _safeWrap(rate);
    }
}
