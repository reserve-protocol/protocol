// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "../curve/CurveStableCollateral.sol";

interface IPricePerShareHelper {
    /// @notice Helper function to convert shares to underlying amount with exact precision
    /// @param vault The yToken address
    /// @param shares {qTok}
    /// @return {qLP Token}
    function sharesToAmount(address vault, uint256 shares) external view returns (uint256);
}

/**
 * @title YearnV2 Curve Fiat Collateral
 * @notice Collateral plugin for a Yearn V2 Vault for a fiatcoin curve pool, eg yvCurveUSDCcrvUSD
 * tok = yvCurveUSDCcrvUSD
 * ref = crvUSDUSDC-f's underlying virtual token
 * tar = USD
 * UoA = USD
 *
 * More on the ref token: crvUSDUSDC-f has a virtual price. The ref token to measure is not the
 * balance of crvUSDUSDC-f that the LP token is redeemable for, but the balance of the virtual
 * token that underlies crvUSDUSDC-f. This virtual token is an evolving mix of USDC and crvUSD.
 *
 * Should only be used for Stable pools.
 * No rewards (handled internally by the Yearn vault).
 * Revenue hiding can be kept very small since stable curve pools should be up-only.
 */
contract YearnV2CurveFiatCollateral is CurveStableCollateral {
    using FixLib for uint192;

    IPricePerShareHelper public immutable pricePerShareHelper;

    /// @dev config Unused members: chainlinkFeed, oracleError, oracleTimeout
    /// @dev config.erc20 should be a RewardableERC20
    constructor(
        CollateralConfig memory config,
        uint192 revenueHiding,
        PTConfiguration memory ptConfig,
        IPricePerShareHelper pricePerShareHelper_
    ) CurveStableCollateral(config, revenueHiding, ptConfig) {
        pricePerShareHelper = pricePerShareHelper_;
    }

    /// Can revert, used by other contract functions in order to catch errors
    /// Should not return FIX_MAX for low
    /// Should only return FIX_MAX for high if low is 0
    /// Should NOT be manipulable by MEV
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
        uint192 supply = shiftl_toFix(lpToken.totalSupply(), -int8(lpToken.decimals()), FLOOR);
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

    // solhint-disable no-empty-blocks

    /// @custom:delegate-call
    function claimRewards() external virtual override {
        // No rewards to claim, everything is part of the pricePerShare
    }

    // solhint-enable no-empty-blocks

    // === Internal ===

    /// @return {ref/tok} Actual quantity of whole reference units per whole collateral tokens
    function underlyingRefPerTok() public view virtual override returns (uint192) {
        // {ref/tok} = {ref/LP token} * {LP token/tok}
        return _safeWrap(curvePool.get_virtual_price()).mul(_pricePerShare(), FLOOR);
    }

    /// @return {LP token/tok}
    function _pricePerShare() internal view returns (uint192) {
        uint256 supply = erc20.totalSupply(); // {qTok}
        uint256 amount = pricePerShareHelper.sharesToAmount(address(erc20), supply); // {qLP Token}

        // yvCurve tokens always have the same number of decimals as the underlying curve LP token,
        // so we can divide the quanta units without converting to whole units

        // {LP token/tok} = {LP token} / {tok}
        return divuu(amount, supply);
    }
}
