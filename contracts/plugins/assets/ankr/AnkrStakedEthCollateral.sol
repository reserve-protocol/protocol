// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "../../../libraries/Fixed.sol";
import "../AppreciatingFiatCollateral.sol";
import "../OracleLib.sol";
import "./IAnkrETH.sol";

/**
 * @title Ankr Staked Eth Collateral
 * @notice Collateral plugin for Ankr ankrETH,
 * tok = ankrETH
 * ref = ETH
 * tar = ETH
 * UoA = USD
 */
contract AnkrStakedEthCollateral is AppreciatingFiatCollateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    // solhint-disable no-empty-blocks
    /// @param config.chainlinkFeed Feed units: {UoA/ref}
    constructor(CollateralConfig memory config, uint192 revenueHiding)
        AppreciatingFiatCollateral(config, revenueHiding)
    {}

    // solhint-enable no-empty-blocks

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
        uint192 pricePerRef = chainlinkFeed.price(oracleTimeout); // {UoA/ref}

        // {UoA/tok} = {UoA/ref} * {ref/tok}
        uint192 p = pricePerRef.mul(_underlyingRefPerTok());
        uint192 err = p.mul(oracleError, CEIL);

        low = p - err;
        high = p + err;
        // assert(low <= high); obviously true just by inspection

        pegPrice = targetPerRef(); // ETH/ETH
    }

    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    function _underlyingRefPerTok() internal view override returns (uint192) {
        uint256 rate = IAnkrETH(address(erc20)).ratio();
        return FIX_ONE.div(_safeWrap(rate), FLOOR);
    }
}
