// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "../../interfaces/IAsset.sol";
import "../../libraries/Fixed.sol";
import "./FiatCollateral.sol";
import "./Asset.sol";
import "./OracleLib.sol";

/**
 * @title RevenueHidingCollateral
 *
 * For: {tok} != {ref}, {ref} != {target}, {target} == {UoA}
 * Inheritors _must_ implement _underlyingRefPerTok()
 * Can be easily extended by (optionally) re-implementing:
 *   - tryPrice()
 *   - refPerTok()
 *   - targetPerRef()
 *   - claimRewards()
 * Should not have to re-implement any other methods.
 *
 * Can intentionally disable default checks by setting config.defaultThreshold to 0
 * Can intentionally do no revenue hiding by setting revenueHiding to 0
 */
abstract contract RevenueHidingCollateral is FiatCollateral {
    using FixLib for uint192;
    using OracleLib for AggregatorV3Interface;

    // useful to prevent becoming DISABLED during hiccup downturns
    uint192 public immutable revenueHiding; // {1} The minimum fraction of refPerTok to show

    // does not become nonzero until after first refresh()
    uint192 public exposedReferencePrice; // {ref/tok} max ref price observed, sub revenue hiding

    /// @param config.chainlinkFeed Feed units: {UoA/ref}
    /// @param revenueHiding_ {1} A value like 1e-6 that represents the maximum refPerTok to hide
    constructor(CollateralConfig memory config, uint192 revenueHiding_) FiatCollateral(config) {
        require(revenueHiding_ < FIX_ONE, "revenueHiding too big");
        revenueHiding = revenueHiding_;
    }

    /// Can revert, used by other contract functions in order to catch errors
    /// Should not return FIX_MAX for low
    /// Should only return FIX_MAX for high if low is 0
    /// @dev Override this when pricing is more complicated than just a single oracle
    /// @param low {UoA/tok} The low price estimate
    /// @param high {UoA/tok} The high price estimate
    /// @param pegPrice {target/ref} The actual price observed in the peg
    function tryPrice()
        external
        view
        virtual
        override
        returns (
            uint192 low,
            uint192 high,
            uint192 pegPrice
        )
    {
        pegPrice = chainlinkFeed.price(oracleTimeout); // {target/ref}

        // {UoA/tok} = {target/ref} * {ref/tok} * {UoA/target} (1)
        uint192 p = pegPrice.mul(refPerTok());
        uint192 delta = p.mul(oracleError);

        low = p - delta;
        high = p + delta;
    }

    /// Should not revert
    /// Refresh exchange rates and update default status.
    /// @dev Should be general enough to not need to be overridden
    function refresh() public virtual override {
        if (alreadyDefaulted()) return;
        CollateralStatus oldStatus = status();

        // Check for soft default + save lotPrice
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

        // Check for hard default

        // revenue hiding: do not DISABLE if drawdown is small
        // uint192(<) is equivalent to Fix.lt
        uint192 underlyingRefPerTok = _underlyingRefPerTok();
        if (underlyingRefPerTok < exposedReferencePrice) {
            markStatus(CollateralStatus.DISABLED);
        }

        // {ref/tok} = {ref/tok} * {1}
        uint192 hiddenReferencePrice = underlyingRefPerTok.mul(FIX_ONE.minus(revenueHiding));
        if (hiddenReferencePrice > exposedReferencePrice) {
            exposedReferencePrice = hiddenReferencePrice;
        }

        CollateralStatus newStatus = status();
        if (oldStatus != newStatus) {
            emit CollateralStatusChanged(oldStatus, newStatus);
        }
    }

    /// @return {ref/tok} Shielded quantity of whole reference units per whole collateral tokens
    function refPerTok() public view virtual override returns (uint192) {
        return exposedReferencePrice;
    }

    /// Should update in inheritors
    /// @return {ref/tok} Actual quantity of whole reference units per whole collateral tokens
    function _underlyingRefPerTok() internal view virtual returns (uint192);
}
