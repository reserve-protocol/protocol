// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "contracts/plugins/assets/AppreciatingFiatCollateral.sol";
import "contracts/plugins/lido/IWSTETH.sol";
import "contracts/plugins/assets/OracleLib.sol";
import "contracts/libraries/Fixed.sol";

/**
 * @title Lido Staked Eth Collateral
 * @notice Collateral plugin for Lido stETH,
 * tok = wstETH  (wrapped stETH)
 * ref = stETH (pegged to ETH 1:1)
 * tar = ETH
 * UoA = USD
 */
contract LidoStakedEthCollateral is AppreciatingFiatCollateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    AggregatorV3Interface public immutable targetUnitChainlinkFeed; // {UoA/target}
    uint48 public immutable targetUnitOracleTimeout; // {s}

    constructor(
        CollateralConfig memory config,
        uint192 revenueHiding,
        AggregatorV3Interface targetUnitChainlinkFeed_,
        uint48 targetUnitOracleTimeout_
    ) AppreciatingFiatCollateral(config, revenueHiding) {
        require(address(targetUnitChainlinkFeed_) != address(0), "missing targetUnit feed");
        require(targetUnitOracleTimeout_ > 0, "targetUnitOracleTimeout zero");
        targetUnitChainlinkFeed = targetUnitChainlinkFeed_;
        targetUnitOracleTimeout = targetUnitOracleTimeout_;
        exposedReferencePrice = _underlyingRefPerTok().mul(revenueShowing);
    }

    /// Can revert, used by other contract functions in order to catch errors
    /// @param low {UoA/tok} The low price estimate
    /// @param high {UoA/tok} The high price estimate
    /// @param pegPrice {target/ref}
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
        // Get current market peg {eth/steth}, but the intended {target/ref} will be returned
        pegPrice = chainlinkFeed.price(oracleTimeout); // {target/ref}

        // {UoA/target}
        uint192 pricePerTarget = targetUnitChainlinkFeed.price(targetUnitOracleTimeout);

        // {UoA/tok} = {UoA/target} * {target/ref} * {ref/tok}
        uint192 pLow = pricePerTarget.mul(pegPrice).mul(refPerTok());
        uint192 pHigh = pricePerTarget.mul(pegPrice).mul(_underlyingRefPerTok());

        low = pLow - pLow.mul(oracleError);
        high = pHigh + pHigh.mul(oracleError);

        pegPrice = targetPerRef();
    }

    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    function _underlyingRefPerTok() internal view override returns (uint192) {
        uint256 rate = IWSTETH(address(erc20)).stEthPerToken();
        return _safeWrap(rate);
    }
}
