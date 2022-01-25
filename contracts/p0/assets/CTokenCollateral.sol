// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/p0/Collateral.sol";

// cToken initial exchange rate is 0.02

// https://github.com/compound-finance/compound-protocol/blob/master/contracts/CToken.sol
interface ICToken {
    /// @dev From Compound Docs:
    /// The current (up to date) exchange rate, scaled by 10^(18 - 8 + Underlying Token Decimals).
    function exchangeRateCurrent() external returns (uint256);

    /// @dev From Compound Docs: The stored exchange rate, with 18 - 8 + UnderlyingAsset.Decimals.
    function exchangeRateStored() external view returns (uint256);
}

contract CTokenCollateralP0 is CollateralP0 {
    using FixLib for Fix;
    using SafeERC20 for IERC20Metadata;
    // All cTokens have 8 decimals, but their underlying may have 18 or 6 or something else.

    Fix public immutable initialExchangeRate; // 0.02, their hardcoded starting rate

    IERC20Metadata public immutable underlyingERC20; // this should be the underlying fiatcoin

    Fix public prevRateToUnderlying; // previous rate to underlying, in normal 1:1 units

    // {ref/tok} The rate to underlying of this derivative asset at some RToken-specific
    // previous time. Used when choosing new baskets.
    Fix private immutable genesisRateToUnderlying;

    constructor(
        IERC20Metadata erc20_,
        IMain main_,
        IOracle oracle_,
        bytes32 role_,
        Fix govScore_,
        IERC20Metadata underlyingERC20_
    ) CollateralP0(erc20_, main_, oracle_, role_, govScore_) {
        initialExchangeRate = toFixWithShift(2, -2);
        underlyingERC20 = underlyingERC20_;
        genesisRateToUnderlying = rateToUnderlying();
        prevRateToUnderlying = genesisRateToUnderlying;
    }

    /// Update the Compound protocol + default status
    function forceUpdates() public virtual override {
        if (whenDefault <= block.timestamp) {
            return;
        }

        // Update Compound
        ICToken(address(erc20)).exchangeRateCurrent();

        // Check invariants
        Fix rate = rateToUnderlying();
        if (rate.lt(prevRateToUnderlying)) {
            whenDefault = block.timestamp;
        } else {
            // If the underlying is showing signs of depegging, default eventually
            whenDefault = _isUnderlyingDepegged()
                ? Math.min(whenDefault, block.timestamp + main.defaultDelay())
                : NEVER;
        }
        prevRateToUnderlying = rate;
    }

    /// @dev Intended to be used via delegatecall
    function claimAndSweepRewards(ICollateral collateral, IMain main_) external virtual override {
        // TODO: We need to ensure that calling this function directly,
        // without delegatecall, does not allow anyone to extract value.
        // This should already be the case because the Collateral
        // contract itself should never earn rewards.

        // compound groups all rewards automatically
        // we still need to use `collateral` to avoid storage reads in the delegateCall
        collateral.oracle().comptroller().claimComp(address(this));
        uint256 amount = main_.compAsset().erc20().balanceOf(address(this));
        if (amount > 0) {
            main_.compAsset().erc20().safeTransfer(address(main_), amount);
        }
    }

    /// @return {attoUSD/qTok} The price of 1 qToken in attoUSD
    function price() public view virtual override returns (Fix) {
        // {attoUSD/qTok} = {attoUSD/ref} * {ref/tok} / {qTok/tok}
        return oracle.consult(underlyingERC20).mul(rateToUnderlying()).shiftLeft(8);
    }

    /// @return {none} The growth since genesis
    function growth() public view override returns (Fix) {
        return rateToUnderlying().div(genesisRateToUnderlying);
    }

    /// @return {ref/tok} The rate between the cToken and its fiatcoin
    function rateToUnderlying() public view virtual returns (Fix) {
        uint256 rate = ICToken(address(erc20)).exchangeRateStored();
        int8 shiftLeft = 8 - int8(underlyingERC20.decimals()) - 18;
        Fix rateNow = toFixWithShift(rate, shiftLeft);
        return rateNow.div(initialExchangeRate);
    }

    function _isUnderlyingDepegged() internal view returns (bool) {
        // {USD/ref} = {none} * {USD/ref}
        Fix delta = main.defaultThreshold().mul(PEG);

        // {USD/ref} = {attoUSD/ref} / {attoUSD/USD}
        Fix p = oracle.consult(underlyingERC20).shiftLeft(-18);

        return p.lt(PEG.minus(delta)) || p.gt(PEG.plus(delta));
    }
}
