// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "../../libraries/Fixed.sol";
import "../assets/AppreciatingFiatCollateral.sol";

/**
 * @title InvalidoRefPerTokCollateralMock
 * @notice Collateral mock plugin which allows to set refPerTok=0 or revert
 */
contract InvalidRefPerTokCollateralMock is AppreciatingFiatCollateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    uint192 public rateMock = FIX_ONE;
    bool public refPerTokRevert;

    // solhint-disable no-empty-blocks

    constructor(CollateralConfig memory config, uint192 revenueHiding)
        AppreciatingFiatCollateral(config, revenueHiding)
    {}

    // solhint-enable no-empty-blocks

    function refresh() public virtual override {
        CollateralStatus oldStatus = status();
        try this.underlyingRefPerTok() returns (uint192 underlyingRefPerTok_) {
            // {ref/tok} = {ref/tok} * {1}
            uint192 hiddenReferencePrice = underlyingRefPerTok_.mul(revenueShowing);

            exposedReferencePrice = hiddenReferencePrice;

            // Check for soft default + save prices
            try this.tryPrice() returns (uint192 low, uint192 high, uint192 pegPrice) {
                // {UoA/tok}, {UoA/tok}, {target/ref}
                // (0, 0) is a valid price; (0, FIX_MAX) is unpriced

                // Save prices if high price is finite
                if (high != FIX_MAX) {
                    savedLowPrice = low;
                    savedHighPrice = high;
                    savedPegPrice = pegPrice;
                    lastSave = uint48(block.timestamp);
                }
            } catch (bytes memory errData) {
                // see: docs/solidity-style.md#Catching-Empty-Data
                if (errData.length == 0) revert(); // solhint-disable-line reason-string
                markStatus(CollateralStatus.IFFY);
            }
        } catch (bytes memory errData) {
            // see: docs/solidity-style.md#Catching-Empty-Data
            if (errData.length == 0) revert(); // solhint-disable-line reason-string
            markStatus(CollateralStatus.DISABLED);
        }

        CollateralStatus newStatus = status();
        if (oldStatus != newStatus) {
            emit CollateralStatusChanged(oldStatus, newStatus);
        }
    }

    // Setter to allow to set refPerTok = 0 on the fly
    function setRate(uint192 rate) external {
        rateMock = rate;
    }

    // Setter to make refPerTok revert
    function setRefPerTokRevert(bool on) external {
        refPerTokRevert = on;
    }

    // Setter for status
    function setStatus(CollateralStatus _status) external {
        markStatus(_status);
    }

    function refPerTok() public view virtual override returns (uint192) {
        if (refPerTokRevert) revert(); // Revert with no reason
        return rateMock;
    }

    /// @return {ref/tok} Actual quantity of whole reference units per whole collateral tokens
    function underlyingRefPerTok() public view override returns (uint192) {
        return rateMock;
    }
}
