// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/libraries/Fixed.sol";
import "./PeggedCollateral.sol";

/**
 * @title LendingCollateralP0
 * @notice A general lending asset such as a cToken or aToken.
 */
abstract contract LendingCollateralP0 is PeggedCollateralP0 {
    using FixLib for Fix;

    Fix public prevRateToUnderlying; // previous rate to underlying, in normal 1:1 units

    /// Check the lending invariants
    function forceUpdates() public virtual override {
        Fix rate = rateToUnderlying();
        if (whenDefault > block.timestamp && rate.lt(prevRateToUnderlying)) {
            whenDefault = block.timestamp;
        } else {
            super.forceUpdates();
        }
        prevRateToUnderlying = rate;
    }

    /// @return {attoUSD/qTok} The price of 1 qToken in attoUSD
    function priceUSD() public view override returns (Fix) {
        return super.priceUSD().mul(rateToUnderlying());
    }

    /// @return {attoUoA/qTok} The price of the asset in its unit of account
    function priceUoA() public view virtual override returns (Fix) {
        return super.priceUoA().mul(rateToUnderlying());
    }

    /// @return {attoUoA/tok} Minimum price of a pegged asset to be considered non-defaulting
    function minPrice() public view virtual override returns (Fix) {
        return super.minPrice().mul(rateToUnderlying());
    }

    /// @return {underlyingTok/tok} The rate between the lending token and its fiatcoin
    function rateToUnderlying() public view virtual returns (Fix);
}
