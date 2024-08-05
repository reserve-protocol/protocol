// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

// solhint-disable-next-line max-line-length
import { AggregatorV3Interface } from "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import { CollateralConfig } from "../AppreciatingFiatCollateral.sol";
import { FixLib, CEIL } from "../../../libraries/Fixed.sol";
import { OracleLib } from "../OracleLib.sol";
import { ERC4626FiatCollateral } from "../ERC4626FiatCollateral.sol";

/**
 * @title MetaMorphoSelfReferentialCollateral
 * @notice Collateral plugin for a MetaMorpho vault with self referential collateral, like WETH
 * Expected: {tok} != {ref}, {ref} == {target}, {target} != {UoA}
 *
 * For example: Re7WETH
 */
contract MetaMorphoSelfReferentialCollateral is ERC4626FiatCollateral {
    using FixLib for uint192;
    using OracleLib for AggregatorV3Interface;

    /// config.erc20 must be a MetaMorpho ERC4626 vault
    /// @param config.chainlinkFeed Feed units: {UoA/ref}
    /// @param revenueHiding {1} A value like 1e-6 that represents the maximum refPerTok to hide
    constructor(CollateralConfig memory config, uint192 revenueHiding)
        ERC4626FiatCollateral(config, revenueHiding)
    {
        require(config.defaultThreshold == 0, "defaultThreshold not zero");
    }

    /// Can revert, used by other contract functions in order to catch errors
    /// Should NOT be manipulable by MEV
    /// @return low {UoA/tok} The low price estimate
    /// @return high {UoA/tok} The high price estimate
    /// @return pegPrice {target/ref}
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
        uint192 p = chainlinkFeed.price(oracleTimeout).mul(underlyingRefPerTok());
        uint192 err = p.mul(oracleError, CEIL);

        low = p - err;
        high = p + err;
        // assert(low <= high); obviously true just by inspection

        pegPrice = targetPerRef();
    }
}
