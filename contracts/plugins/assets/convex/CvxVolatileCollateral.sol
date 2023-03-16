// SPDX-License-Identifier: ISC
pragma solidity 0.8.17;
import "./CvxStableCollateral.sol";

/**
 * @title CvxVolatileCollateral
 *  This plugin contract extends CvxCurveStableCollateral to work for
 *  volatile pools like TriCrypto
 */
contract CvxVolatileCollateral is CvxStableCollateral {
    using FixLib for uint192;

    // this isn't saved by our parent classes, but we'll need to track it
    uint192 internal immutable _defaultThreshold; // {1}

    constructor(
        CollateralConfig memory config,
        uint192 revenueHiding,
        PTConfiguration memory ptConfig
    ) CvxStableCollateral(config, revenueHiding, ptConfig) {
        _defaultThreshold = config.defaultThreshold;
    }

    /// Should not revert
    /// Refresh exchange rates and update default status.
    /// Have to override to add custom default checks
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
        try this.tryPrice() returns (uint192 low, uint192 high, uint192) {
            // {UoA/tok}, {UoA/tok}, {UoA/tok}
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
            if (low == 0 || _anyDepegged()) {
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

    // Override this later to implement non-stable pools
    function _anyDepegged() internal view override returns (bool) {
        uint192[] memory balances = getBalances(); // [{tok}]
        uint192[] memory vals = new uint192[](balances.length); // {UoA}
        uint192 valSum; // {UoA}

        // Calculate vals
        for (uint8 i = 0; i < nTokens; i++) {
            try this.tokenPrice(i) returns (uint192 low, uint192 high) {
                // {UoA/tok} = {UoA/tok} + {UoA/tok}
                uint192 mid = (low + high) / 2;

                // {UoA} = {tok} * {UoA/tok}
                vals[i] = balances[i].mul(mid);
                valSum += vals[i];
            } catch (bytes memory errData) {
                // see: docs/solidity-style.md#Catching-Empty-Data
                if (errData.length == 0) revert(); // solhint-disable-line reason-string
                return true;
            }
        }

        // Check distribution of capital
        uint192 expected = FIX_ONE.divu(nTokens); // {1}
        for (uint8 i = 0; i < nTokens; i++) {
            uint192 observed = divuu(vals[i], valSum); // {1}
            if (observed > expected) {
                if (observed - expected > _defaultThreshold) return true;
            }
        }

        return false;
    }
}
