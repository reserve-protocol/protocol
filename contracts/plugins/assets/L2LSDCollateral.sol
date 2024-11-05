// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { CEIL, FIX_MAX, FixLib, _safeWrap } from "../../libraries/Fixed.sol";
import { AggregatorV3Interface, OracleLib } from "./OracleLib.sol";
import { CollateralConfig, AppreciatingFiatCollateral } from "./AppreciatingFiatCollateral.sol";
import { CollateralStatus } from "../../interfaces/IAsset.sol";

/**
 * @title L2LSDCollateral
 * @notice Base collateral plugin for LSDs on L2s.  Inherited per collateral.
 * @notice underlyingRefPerTok uses a chainlink feed rather than direct contract calls.
 */
abstract contract L2LSDCollateral is AppreciatingFiatCollateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    AggregatorV3Interface public immutable exchangeRateChainlinkFeed;
    uint48 public immutable exchangeRateChainlinkTimeout;

    /// @param config.chainlinkFeed {UoA/target} price of ETH in USD terms
    /// @param revenueHiding {1} A value like 1e-6 that represents the maximum refPerTok to hide
    /// @param _exchangeRateChainlinkFeed {target/tok} L1 LSD exchange rate, oraclized to L2
    /// @param _exchangeRateChainlinkTimeout {s} Timeout for L1 LSD exchange rate oracle
    constructor(
        CollateralConfig memory config,
        uint192 revenueHiding,
        AggregatorV3Interface _exchangeRateChainlinkFeed,
        uint48 _exchangeRateChainlinkTimeout
    ) AppreciatingFiatCollateral(config, revenueHiding) {
        require(address(_exchangeRateChainlinkFeed) != address(0), "missing exchangeRate feed");
        require(_exchangeRateChainlinkTimeout != 0, "exchangeRateChainlinkTimeout zero");
        require(config.defaultThreshold != 0, "defaultThreshold zero");

        exchangeRateChainlinkFeed = _exchangeRateChainlinkFeed;
        exchangeRateChainlinkTimeout = _exchangeRateChainlinkTimeout;
        maxOracleTimeout = uint48(Math.max(maxOracleTimeout, _exchangeRateChainlinkTimeout));
    }

    /// Should not revert
    /// Refresh exchange rates and update default status.
    /// @dev Should not need to override: can handle collateral with variable refPerTok()
    function refresh() public virtual override {
        CollateralStatus oldStatus = status();

        // Check for hard default
        // must happen before tryPrice() call since `refPerTok()` returns a stored value

        // revenue hiding: do not DISABLE if drawdown is small
        // underlyingRefPerTok may fail call to chainlink oracle, need to catch
        try this.underlyingRefPerTok() returns (uint192 underlyingRefPerTok_) {
            // {ref/tok} = {ref/tok} * {1}
            uint192 hiddenReferencePrice = underlyingRefPerTok_.mul(revenueShowing);

            // uint192(<) is equivalent to Fix.lt
            if (underlyingRefPerTok_ < exposedReferencePrice) {
                exposedReferencePrice = underlyingRefPerTok_;
                markStatus(CollateralStatus.DISABLED);
            } else if (hiddenReferencePrice > exposedReferencePrice) {
                exposedReferencePrice = hiddenReferencePrice;
            }

            // Check for soft default + save prices
            try this.tryPrice() returns (uint192 low, uint192 high, uint192 pegPrice) {
                // {UoA/tok}, {UoA/tok}, {target/ref}
                // (0, 0) is a valid price; (0, FIX_MAX) is unpriced

                // Save prices if priced
                if (high != FIX_MAX) {
                    savedLowPrice = low;
                    savedHighPrice = high;
                    savedPegPrice = pegPrice;
                    lastSave = uint48(block.timestamp);
                } else {
                    // must be unpriced
                    assert(low == 0);
                }

                // If the price is below the default-threshold price, default eventually
                // uint192(+/-) is the same as Fix.plus/minus
                if (pegPrice < pegBottom || pegPrice > pegTop || low == 0) {
                    markStatus(CollateralStatus.IFFY);
                } else {
                    markStatus(CollateralStatus.SOUND);
                }
            } catch (bytes memory errData) {
                // see: docs/solidity-style.md#Catching-Empty-Data
                if (errData.length == 0) revert(); // solhint-disable-line reason-string
                markStatus(CollateralStatus.IFFY);
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
    function underlyingRefPerTok() public view override returns (uint192) {
        return exchangeRateChainlinkFeed.price(exchangeRateChainlinkTimeout);
    }
}
