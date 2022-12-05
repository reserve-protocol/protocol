// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "../assets/ATokenFiatCollateral.sol";

contract BadCollateralPlugin is ATokenFiatCollateral {
    using FixLib for uint192;
    using OracleLib for AggregatorV3Interface;

    bool public checkSoftDefault = true; // peg
    bool public checkHardDefault = true; // defi invariant

    constructor(CollateralConfig memory config) ATokenFiatCollateral(config) {}

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
        if (alreadyDefaulted()) return;
        CollateralStatus oldStatus = status();

        // Check for soft default
        if (checkSoftDefault) {
            try this.tryPrice() returns (uint192 low, uint192, uint192 pegPrice) {
                // {UoA/tok}, {UoA/tok}, {target/ref}

                // If the price is below the default-threshold price, default eventually
                // uint192(+/-) is the same as Fix.plus/minus
                if (low == 0 || pegPrice < pegBottom || pegPrice > pegTop) {
                    markStatus(CollateralStatus.IFFY);
                } else {
                    lastPrice = low;
                    lastTimestamp = uint48(block.timestamp);
                    markStatus(CollateralStatus.SOUND);
                }
            } catch (bytes memory errData) {
                // see: docs/solidity-style.md#Catching-Empty-Data
                if (errData.length == 0) revert(); // solhint-disable-line reason-string
            }
        }

        // Check for hard default
        uint192 referencePrice = refPerTok();
        // uint192(<) is equivalent to Fix.lt
        if (checkHardDefault && referencePrice < prevReferencePrice) {
            markStatus(CollateralStatus.DISABLED);
        }
        prevReferencePrice = referencePrice;

        CollateralStatus newStatus = status();
        if (oldStatus != newStatus) {
            emit CollateralStatusChanged(oldStatus, newStatus);
        }
    }
}
