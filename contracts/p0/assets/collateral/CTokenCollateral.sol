// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/assets/collateral/Collateral.sol";
import "contracts/libraries/Fixed.sol";

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
        IMain main_
    ) CollateralP0(uoa_, erc20_, main_, Oracle.Source.COMPOUND) {
        initialExchangeRate = toFixWithShift(2, -2);
    }

    /// Update the Compound protocol + default status
    function forceUpdates() public virtual override {
        ICToken(address(erc20)).exchangeRateCurrent();
        _updateDefaultStatus();
    }

    /// @return {underlyingTok/tok} Conversion rate between token and its underlying.
    function _rateToUnderlying() internal view override returns (Fix) {
        uint256 rate = ICToken(_erc20).exchangeRateStored();
        int8 shiftLeft = int8(decimals()) - int8(fiatcoinDecimals()) - 18;
        Fix rateNow = toFixWithShift(rate, shiftLeft);
        return rateNow.div(initialExchangeRate);
    }
}
