// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "../../../libraries/Fixed.sol";
import "../AppreciatingFiatCollateral.sol";
import "../OracleLib.sol";
import "./interfaces/IPoolService.sol";

/**
 * @title GearBoxFiatCollateral
 * @notice Collateral plugin for Gearbox Fiat Liquidity Pool collateral,
 * tok = dDAI | dUSDC | dFrax
 * ref = DAI | USDC | Frax
 * tar = DAI | USDC | Frax
 * UoA = USD
 */
contract GearBoxFiatCollateral is AppreciatingFiatCollateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    IPoolService public immutable poolService;
    

    /// @param config.chainlinkFeed Feed units: {UoA/ref}
    constructor(
        CollateralConfig memory config,
        uint192 revenueHiding,
        IPoolService _poolService
    ) AppreciatingFiatCollateral(config, revenueHiding) {
        poolService = _poolService;
    }

    /// Can revert, used by other contract functions in order to catch errors
    /// @return low {UoA/tok} The low price estimate
    /// @return high {UoA/tok} The high price estimate
    /// @return pegPrice {target/ref} The actual price observed in the peg
    function tryPrice()
        external
        view
        override
        returns (
            uint192 low,
            uint192 high,
            uint192 pegPrice
        )
    {
        // {UoA/tok} = {UoA/ref} * {ref/tok}
        uint192 pricePerRef = chainlinkFeed.price(oracleTimeout); // {UoA/ref}

        uint192 p = pricePerRef.mul(_underlyingRefPerTok());
        uint192 err = p.mul(oracleError, CEIL);

        high = p + err;
        low = p - err;

        pegPrice = targetPerRef(); // {target/ref} DAI/DAI is always 1
    }

    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    function _underlyingRefPerTok() internal view override returns (uint192) {
       
        return _safeWrap(poolService.fromDiesel(1e18));
    }
}
