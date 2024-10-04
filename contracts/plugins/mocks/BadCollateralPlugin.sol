// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "../assets/aave/ATokenFiatCollateral.sol";

contract BadCollateralPlugin is ATokenFiatCollateral {
    using FixLib for uint192;
    using OracleLib for AggregatorV3Interface;

    bool public checkSoftDefault = true; // peg
    bool public checkHardDefault = true; // defi invariant

    constructor(CollateralConfig memory config, uint192 revenueHiding)
        ATokenFiatCollateral(config, revenueHiding)
    {}

    function setSoftDefaultCheck(bool on) external {
        checkSoftDefault = on;
    }

    function setHardDefaultCheck(bool on) external {
        checkHardDefault = on;
    }

    /// Should not revert
    /// Refresh exchange rates and update default status.
    /// @dev Should be general enough to not need to be overridden
    function refresh() public virtual override {
        CollateralStatus oldStatus = status();

        // Check for hard default
        // must happen before tryPrice() call since `refPerTok()` returns a stored value

        // revenue hiding: do not DISABLE if drawdown is small
        uint192 underlyingRefPerTok_ = underlyingRefPerTok();

        // {ref/tok} = {ref/tok} * {1}
        uint192 hiddenReferencePrice = underlyingRefPerTok_.mul(revenueShowing);

        // uint192(<) is equivalent to Fix.lt
        if (checkHardDefault && underlyingRefPerTok_ < exposedReferencePrice) {
            exposedReferencePrice = hiddenReferencePrice;
            markStatus(CollateralStatus.DISABLED);
        } else if (!checkHardDefault || hiddenReferencePrice > exposedReferencePrice) {
            exposedReferencePrice = hiddenReferencePrice;
        }

        // Check for soft default
        if (checkSoftDefault) {
            try this.tryPrice() returns (uint192 low, uint192 high, uint192 pegPrice) {
                // {UoA/tok}, {UoA/tok}, {target/ref}

                // high can't be FIX_MAX in this contract, but inheritors might mess this up
                if (high != FIX_MAX) {
                    // Save prices
                    savedLowPrice = low;
                    savedHighPrice = high;
                    savedPegPrice = pegPrice;
                    lastSave = uint48(block.timestamp);
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
            }
        }

        CollateralStatus newStatus = status();
        if (oldStatus != newStatus) {
            emit CollateralStatusChanged(oldStatus, newStatus);
        }
    }
}
