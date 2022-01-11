// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/p0/interfaces/IMain.sol";
import "contracts/libraries/Fixed.sol";
import "./Collateral.sol";

// cToken initial exchange rate is 0.02

// https://github.com/compound-finance/compound-protocol/blob/master/contracts/CToken.sol
interface ICToken {
    /// @dev From Compound Docs:
    /// The current (up to date) exchange rate, scaled by 10^(18 - 8 + Underlying Token Decimals).
    function exchangeRateCurrent() external returns (uint256);

    /// @dev From Compound Docs: The stored exchange rate, with 18 - 8 + UnderlyingAsset.Decimals.
    function exchangeRateStored() external view returns (uint256);

    function underlying() external view returns (address);
}

contract CTokenCollateralP0 is CollateralP0 {
    using FixLib for Fix;
    // All cTokens have 8 decimals, but their underlying may have 18 or 6 or something else.

    Fix public immutable initialExchangeRate; // 0.02, their hardcoded starting rate

    constructor(
        UoA uoa_,
        IERC20Metadata erc20_,
        IMain main_,
        ICollateral underlying_
    ) CollateralP0(uoa_, erc20_, main_, underlying_.oracle()) {
        underlying = underlying_;
        initialExchangeRate = toFixWithShift(2, -2);
    }

    /// Update the Compound protocol + default status
    function forceUpdates() public virtual override {
        ICToken(address(erc20)).exchangeRateCurrent();
        _updateDefaultStatus();
    }

    /// @return {underlyingTok/tok} The rate between the token and fiatcoin
    function fiatcoinRate() public view override returns (Fix) {
        uint256 rate = ICToken(address(erc20)).exchangeRateStored();
        int8 shiftLeft = 8 - int8(underlyingERC20().decimals()) - 18;
        Fix rateNow = toFixWithShift(rate, shiftLeft);
        return rateNow.div(initialExchangeRate);
    }
}
