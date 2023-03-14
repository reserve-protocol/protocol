// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "contracts/plugins/assets/AppreciatingFiatCollateral.sol";
import "contracts/plugins/assets/OracleLib.sol";
import "contracts/libraries/Fixed.sol";
import "./IsfrxEth.sol";

/**
 * @title SFraxEthCollateral
 * @notice Collateral plugin for Frax-ETH,
 * tok = sfrxETH
 * ref = frxETH
 * tar = ETH
 * UoA = USD

 TODO: a price oracle is needed for ETH/frxETH. there are 2 options:
 1) wait for a chainlink oracle.  the FRAX team is working on getting one, but there is currently
 no ETA
 2) implement a TWAP based on curve
 */
contract SFraxEthCollateral is AppreciatingFiatCollateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    constructor(CollateralConfig memory config, uint192 revenueHiding)
        AppreciatingFiatCollateral(config, revenueHiding)
    {
        exposedReferencePrice = _underlyingRefPerTok().mul(revenueShowing);
    }

    /// Can revert, used by other contract functions in order to catch errors
    /// @param low {UoA/tok} The low price estimate
    /// @param high {UoA/tok} The high price estimate
    /// @param pegPrice {target/ref}
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
        uint192 p = chainlinkFeed.price(oracleTimeout); // target==ref :: {UoA/target} == {UoA/ref}

        // {UoA/tok} = {UoA/ref} * {ref/tok}
        uint192 pLow = p.mul(refPerTok());

        // {UoA/tok} = {UoA/ref} * {ref/tok}
        uint192 pHigh = p.mul(_underlyingRefPerTok());

        low = pLow - pLow.mul(oracleError);
        high = pHigh + pHigh.mul(oracleError);

        pegPrice = targetPerRef();
    }

    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    function _underlyingRefPerTok() internal view override returns (uint192) {
        uint256 rate = IsfrxEth(address(erc20)).pricePerShare();
        return _safeWrap(rate);
    }
}
