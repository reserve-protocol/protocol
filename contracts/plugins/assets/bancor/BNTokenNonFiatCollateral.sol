// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "./BNTokenFiatCollateral.sol";
import "../../../libraries/Fixed.sol";
import "../../../interfaces/IAsset.sol";
import "./IBancorNetworkInfo.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title BNTokenNonFiatCollateral
 * @notice Collateral plugin for a Bancor V3 pool with non-fiat collateral, like WBTC
 * Expected: {tok} != {ref}, {ref} is pegged to {target} unless defaulting, {target} == {UoA}
 */
contract BNTokenNonFiatCollateral is BNTokenFiatCollateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    AggregatorV3Interface public immutable targetUnitChainlinkFeed; // {UoA/target}
    uint48 public immutable targetUnitOracleTimeout; // {s}

    /// @param config Configuration of this collateral. config.erc20 must be the pool token, i.e. bnUSDC
    /// @param _network_info {1} The address to the deployed BancorNetworkInfo contract
    /// @param _underlying_token {2} The token that backs the pool token, i.e. USDC
    /// @param revenue_hiding {3} A value like 1e-6 that represents the maximum refPerTok to hide
    constructor(
        CollateralConfig memory config,
        address _network_info,
        address _underlying_token,
        uint192 revenue_hiding,
        AggregatorV3Interface targetUnitChainlinkFeed_,
        uint48 targetUnitOracleTimeout_
    ) BNTokenFiatCollateral(config, _network_info, _underlying_token, revenue_hiding) {
        targetUnitChainlinkFeed = targetUnitChainlinkFeed_;
        targetUnitOracleTimeout = targetUnitOracleTimeout_;
    }

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
        pegPrice = chainlinkFeed.price(oracleTimeout); // {target/ref}

        // {UoA/tok} = {UoA/target} * {target/ref} * {ref/tok}
        uint192 p = targetUnitChainlinkFeed.price(targetUnitOracleTimeout).mul(pegPrice).mul(
            _underlyingRefPerTok()
        );
        uint192 err = p.mul(oracleError, CEIL);

        low = p - err;
        high = p + err;
        // assert(low <= high); obviously true just by inspection
    }

}
