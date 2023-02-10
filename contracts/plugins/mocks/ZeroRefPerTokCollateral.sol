// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "../../libraries/Fixed.sol";
import "../assets/AppreciatingFiatCollateral.sol";

/**
 * @title ZeroRefPerTokCollateralMock
 * @notice Collateral mock plugin which allows to set refPerTok=0 at anytime without default
 */
contract ZeroRefPerTokCollateralMock is AppreciatingFiatCollateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    uint192 rateMock = FIX_ONE;

    // solhint-disable no-empty-blocks

    constructor(CollateralConfig memory config, uint192 revenueHiding)
        AppreciatingFiatCollateral(config, revenueHiding)
    {}

    // solhint-enable no-empty-blocks

    function refresh() public virtual override {
        CollateralStatus oldStatus = status();
        uint192 underlyingRefPerTok = _underlyingRefPerTok();
        // {ref/tok} = {ref/tok} * {1}
        uint192 hiddenReferencePrice = underlyingRefPerTok.mul(revenueShowing);

        exposedReferencePrice = hiddenReferencePrice;

        // Check for soft default + save prices
        try this.tryPrice() returns (uint192 low, uint192 high, uint192) {
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

    // Setter to allow to set refPerTok = 0 on the fly
    function setRate(uint192 rate) external {
        rateMock = rate;
    }

    function refPerTok() public view virtual override returns (uint192) {
        return rateMock;
    }

    /// @return {ref/tok} Actual quantity of whole reference units per whole collateral tokens
    function _underlyingRefPerTok() internal view override returns (uint192) {
        return rateMock;
    }
}
