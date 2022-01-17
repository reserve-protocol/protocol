// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/libraries/Fixed.sol";
import "./LendingCollateral.sol";

// cToken initial exchange rate is 0.02

// https://github.com/compound-finance/compound-protocol/blob/master/contracts/CToken.sol
interface ICToken {
    /// @dev From Compound Docs:
    /// The current (up to date) exchange rate, scaled by 10^(18 - 8 + Underlying Token Decimals).
    function exchangeRateCurrent() external returns (uint256);

    /// @dev From Compound Docs: The stored exchange rate, with 18 - 8 + UnderlyingAsset.Decimals.
    function exchangeRateStored() external view returns (uint256);
}

contract CTokenCollateralP0 is LendingCollateralP0 {
    using FixLib for Fix;
    using SafeERC20 for IERC20Metadata;
    // All cTokens have 8 decimals, but their underlying may have 18 or 6 or something else.

    Fix public immutable initialExchangeRate; // 0.02, their hardcoded starting rate

    uint8 public immutable decimalsForUnderlying;

    constructor(
        IERC20Metadata erc20_,
        IMain main_,
        IOracle oracle_,
        uint8 decimalsForUnderlying_
    ) PeggedCollateralP0(erc20_, main_, oracle_, FIX_ONE) {
        initialExchangeRate = toFixWithShift(2, -2);
        decimalsForUnderlying = decimalsForUnderlying_;
    }

    /// Update the Compound protocol + default status
    function forceUpdates() public virtual override {
        ICToken(address(erc20)).exchangeRateCurrent();
        super.forceUpdates();
    }

    /// @dev Intended to be used via delegatecall
    function claimAndSweepRewards(ICollateral, IMain main_) external virtual override {
        // TODO: We need to ensure that calling this function directly,
        // without delegatecall, does not allow anyone to extract value.
        // This should already be the case because the Collateral
        // contract itself should never earn rewards.

        // `collateral` being unused here is expected
        // compound groups all rewards automatically, meaning do excessive claims
        oracle.comptroller().claimComp(address(this));
        uint256 amount = main_.compAsset().erc20().balanceOf(address(this));
        if (amount > 0) {
            main_.compAsset().erc20().safeTransfer(address(main), amount);
        }
    }

    /// @return {underlyingTok/tok} The rate between the cToken and its fiatcoin
    function rateToUnderlying() public view virtual override returns (Fix) {
        uint256 rate = ICToken(address(erc20)).exchangeRateStored();
        int8 shiftLeft = 8 - int8(decimalsForUnderlying) - 18;
        Fix rateNow = toFixWithShift(rate, shiftLeft);
        return rateNow.div(initialExchangeRate);
    }
}
