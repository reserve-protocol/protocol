// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "contracts/plugins/assets/AppreciatingFiatCollateral.sol";
import "contracts/plugins/rocket-eth/IReth.sol";
import "contracts/plugins/assets/OracleLib.sol";
import "contracts/libraries/Fixed.sol";

/**
 * @title RethCollateral
 * @notice Collateral plugin for Rocket-Pool ETH,
 * tok = rETH
 * ref = ETH
 * tar = ETH
 * UoA = USD
 */
contract RethCollateral is AppreciatingFiatCollateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    constructor(CollateralConfig memory config, uint192 revenueHiding)
        AppreciatingFiatCollateral(config, revenueHiding)
    {
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
        uint192 p = chainlinkFeed.price(oracleTimeout); // target==ref :: {UoA/target} == {UoA/ref}

        // {UoA/tok} = {UoA/ref} * {ref/tok}
        uint192 pLow = p.mul(refPerTok());

        // {UoA/tok} = {UoA/ref} * {ref/tok}
        uint192 pHigh = p.mul(_underlyingRefPerTok());

        low = pLow - pLow.mul(oracleError);
        high = pHigh + pHigh.mul(oracleError);

        pegPrice = targetPerRef();
    }

    /// Should not revert
    /// Refresh exchange rates and update default status.
    /// @dev Should not need to override: can handle collateral with variable refPerTok()
    function refresh() public virtual override {
        if (alreadyDefaulted()) {
            // continue to update rates
            exposedReferencePrice = _underlyingRefPerTok().mul(revenueShowing);
            return;
        }

        CollateralStatus oldStatus = status();

        // Check for hard default
        // must happen before tryPrice() call since `refPerTok()` returns a stored value

        // revenue hiding: do not DISABLE if drawdown is small
        uint192 underlyingRefPerTok = _underlyingRefPerTok();

        // {ref/tok} = {ref/tok} * {1}
        uint192 hiddenReferencePrice = underlyingRefPerTok.mul(revenueShowing);

        // uint192(<) is equivalent to Fix.lt
        if (underlyingRefPerTok < exposedReferencePrice) {
            exposedReferencePrice = hiddenReferencePrice;
            markStatus(CollateralStatus.DISABLED);
        } else if (hiddenReferencePrice > exposedReferencePrice) {
            exposedReferencePrice = hiddenReferencePrice;
        }

        // Check for soft default + save prices
        try this.tryPrice() returns (uint192 low, uint192 high, uint192 pegPrice) {
            // {UoA/tok}, {UoA/tok}, {target/ref}
            // (0, 0) is a valid price; (0, FIX_MAX) is unpriced

            // Save prices if priced
            if (high < FIX_MAX) {
                savedLowPrice = low;
                savedHighPrice = high;
                lastSave = uint48(block.timestamp);
            } else {
                // must be unpriced
                assert(low == 0);
            }

            // If the price is below the default-threshold price, default eventually
            // uint192(+/-) is the same as Fix.plus/minus
            if (low == 0) {
                markStatus(CollateralStatus.IFFY);
            } else {
                markStatus(CollateralStatus.SOUND);
            }
        } catch (bytes memory errData) {
            // see: docs/solidity-style.md#Catching-Empty-Data
            if (errData.length == 0) revert(); // solhint-disable-line reason-string
            markStatus(CollateralStatus.IFFY);
        }

        CollateralStatus newStatus = status();
        if (oldStatus != newStatus) {
            emit CollateralStatusChanged(oldStatus, newStatus);
        }
    }

    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    function _underlyingRefPerTok() internal view override returns (uint192) {
        uint256 rate = IReth(address(erc20)).getExchangeRate();
        return _safeWrap(rate);
    }
}
