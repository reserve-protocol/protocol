// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/p0/Collateral.sol";

// Interfaces to contracts from: https://git.io/JX7iJ
interface IStaticAToken is IERC20Metadata {
    function claimRewardsToSelf(bool forceUpdate) external;

    // @return RAY{fiatTok/tok}
    function rate() external view returns (uint256);

    // solhint-disable-next-line func-name-mixedcase
    function ATOKEN() external view returns (AToken);

    function getClaimableRewards(address user) external view returns (uint256);
}

interface AToken {
    // solhint-disable-next-line func-name-mixedcase
    function UNDERLYING_ASSET_ADDRESS() external view returns (address);
}

/// @dev In Aave the number of decimals of the staticAToken is always 18, but the
/// underlying rebasing AToken will have the same number of decimals as its fiatcoin.
contract ATokenCollateralP0 is CollateralP0 {
    using FixLib for Fix;
    using SafeERC20 for IERC20Metadata;

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
        underlyingERC20 = underlyingERC20_;
        genesisRateToUnderlying = rateToUnderlying();
        prevRateToUnderlying = genesisRateToUnderlying;
    }

    /// Update default status
    function forceUpdates() public virtual override {
        if (whenDefault <= block.timestamp) {
            return;
        }

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

        IStaticAToken aToken = IStaticAToken(address(collateral.erc20()));
        uint256 amount = aToken.getClaimableRewards(address(this));
        if (amount > 0) {
            aToken.claimRewardsToSelf(true);
            main_.aaveAsset().erc20().safeTransfer(address(main_), amount);
        }
    }

    /// @return {attoUSD/qTok} The price of 1 qToken in attoUSD
    function price() public view virtual override returns (Fix) {
        // {attoUSD/qTok} = {attoUSD/ref} * {ref/tok} / {qTok/tok}
        return oracle.consult(underlyingERC20).mul(rateToUnderlying()).shiftLeft(18);
    }

    /// @return {qTok/BU} The quantity of collateral asset for a given refTarget
    function toQuantity(Fix refTarget) external view override returns (Fix) {
        // {qTok/BU} = {ref/BU} / {ref/tok} * {qTok/tok}
        return refTarget.div(rateToUnderlying()).shiftLeft(18);
    }

    /// @return {none} The vault-selection score of this collateral
    /// @dev That is, govScore * (growth relative to the reference asset)
    function score() external view override returns (Fix) {
        return govScore.mul(rateToUnderlying().div(genesisRateToUnderlying));
    }

    /// @return {ref/tok} The rate between the token and fiatcoin
    function rateToUnderlying() public view virtual returns (Fix) {
        uint256 rateInRAYs = IStaticAToken(address(erc20)).rate(); // {ray ref/tok}
        return toFixWithShift(rateInRAYs, -27);
    }

    function _isUnderlyingDepegged() internal view returns (bool) {
        // {attoUSD/ref} = {USD/ref} * {attoUSD/USD}
        Fix delta = main.defaultThreshold().mul(PEG).shiftLeft(18);

        // {attoUSD/ref}
        Fix p = oracle.consult(underlyingERC20);
        return p.lt(PEG.minus(delta)) || p.gt(PEG.plus(delta));
    }
}
