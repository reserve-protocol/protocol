// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "../curve/CurveStableCollateral.sol";

interface IYearnV2 {
    /// @return {qLP token/tok}
    function pricePerShare() external view returns (uint256);
}

/**
 * @title YearnV2 Curve Fiat Collateral
 * @notice Collateral plugin for a Yearn V2 Vault for a fiatcoin curve pool, eg yvCurveUSDCcrvUSD
 * tok = yvCurveUSDCcrvUSD
 * ref = crvUSDUSDC-f's underlying virtual token
 * tar = USD
 * UoA = USD
 *
 * More on the ref token: crvUSDUSDC-f has a virtual price >=1. The ref token to measure is not the
 * balance of crvUSDUSDC-f that the LP token is redeemable for, but the balance of the virtual
 * token that underlies crvUSDUSDC-f. This virtual token is an evolving mix of USDC and crvUSD.
 *
 * Revenue hiding should be set to the largest % drawdown in a Yearn vault that should
 * not result in default. While it is extremely rare for Yearn to have drawdowns,
 * in principle it is possible and should be planned for.
 *
 * No rewards.
 */
contract YearnV2CurveFiatCollateral is CurveStableCollateral {
    using FixLib for uint192;

    // solhint-disable no-empty-blocks

    constructor(
        CollateralConfig memory config,
        uint192 revenueHiding,
        PTConfiguration memory ptConfig
    ) CurveStableCollateral(config, revenueHiding, ptConfig) {}

    // solhint-enable no-empty-blocks

    /// Can revert, used by other contract functions in order to catch errors
    /// Should not return FIX_MAX for low
    /// Should only return FIX_MAX for high if low is 0
    /// @return low {UoA/tok} The low price estimate
    /// @return high {UoA/tok} The high price estimate
    /// @return {target/ref} Unused. Always 0
    function tryPrice()
        external
        view
        virtual
        override
        returns (
            uint192 low,
            uint192 high,
            uint192
        )
    {
        // {UoA}
        (uint192 aumLow, uint192 aumHigh) = totalBalancesValue();

        // {LP token}
        uint192 supply = shiftl_toFix(lpToken.totalSupply(), -int8(lpToken.decimals()));
        // We can always assume that the total supply is non-zero

        // {UoA/LP token} = {UoA} / {LP token}
        uint192 lpLow = aumLow.div(supply, FLOOR);
        uint192 lpHigh = aumHigh.div(supply, CEIL);

        // {LP token/tok}
        uint192 pricePerShare = _pricePerShare();

        // {UoA/tok} = {UoA/LP token} * {LP token/tok}
        low = lpLow.mul(pricePerShare, FLOOR);
        high = lpHigh.mul(pricePerShare, CEIL);

        return (low, high, 0);
    }

    /// DEPRECATED: claimRewards() will be removed from all assets and collateral plugins
    function claimRewards() external virtual override {
        // No rewards to claim, everything is part of the pricePerShare
    }

    // === Internal ===

    /// @return {ref/tok} Actual quantity of whole reference units per whole collateral tokens
    function _underlyingRefPerTok() internal view virtual override returns (uint192) {
        // {ref/tok} = {ref/LP token} * {LP token/tok}
        return _safeWrap(curvePool.get_virtual_price()).mul(_pricePerShare());
    }

    /// @return {LP token/tok}
    function _pricePerShare() internal view returns (uint192) {
        // {LP token/tok} = {qLP token/tok} * {LP token/qLP token}
        return shiftl_toFix(IYearnV2(address(erc20)).pricePerShare(), -int8(erc20Decimals));
    }
}
