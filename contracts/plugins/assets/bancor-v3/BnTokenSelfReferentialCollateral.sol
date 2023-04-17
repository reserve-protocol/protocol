// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "contracts/libraries/Fixed.sol";
import "contracts/plugins/assets/OracleLib.sol";
import "contracts/plugins/assets/bancor-v3/BnTokenFiatCollateral.sol";
import "contracts/plugins/assets/bancor-v3/vendor/IPoolCollection.sol";
import "contracts/plugins/assets/bancor-v3/vendor/IStandardRewards.sol";

/**
 * @title BnTokenSelfReferentialCollateral
 * @notice Collateral plugin for the token given to the liquidity providers
 * {tok} = bnXYZ
 * {ref} = XYZ, any non-fiat token
 * {target} = XYZ
 * {UoA} = USD
 */
contract BnTokenSelfReferentialCollateral is BnTokenFiatCollateral {
    using FixLib for uint192;
    using OracleLib for AggregatorV3Interface;

    // The Bancor v3 tokens have the same number of decimals than their underlying

    // solhint-disable no-empty-blocks
    /// @param config.chainlinkFeed Feed units: {UoA/ref}
    /// @param poolCollection_ The address of the collection corresponding to the pool
    /// @param standardRewards_ The address of the collection corresponding to the pool
    /// @param revenueHiding {1} A value like 1e-6 that represents the maximum refPerTok to hide
    constructor(
        CollateralConfig memory config,
        IPoolCollection poolCollection_,
        IStandardRewards standardRewards_,
        uint192 revenueHiding
    ) BnTokenFiatCollateral(config, poolCollection_, standardRewards_, revenueHiding) {}

    // solhint-enable no-empty-blocks

    /// Can revert, used by other contract functions in order to catch errors
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
        uint192 p = chainlinkFeed.price(oracleTimeout).mul(_underlyingRefPerTok());
        uint192 err = p.mul(oracleError, CEIL);

        low = p - err;
        high = p + err;
        // assert(low <= high); obviously true just by inspection

        pegPrice = targetPerRef(); // FIX_ONE
    }
}
