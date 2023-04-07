// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "../AppreciatingFiatCollateral.sol";
import "../../../libraries/Fixed.sol";
import "./MorphoAAVEPositionWrapper.sol";


/**
 * @title MorphoAAVESelfReferentialCollateral
 * @notice Collateral plugin for a Morpho AAVE pool with self referential collateral, like stETH
 * Expected: {tok} != {ref}, {ref} is pegged to {target} unless defaulting, {target} == {UoA}
 */
contract MorphoAAVESelfReferentialCollateral is AppreciatingFiatCollateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    MorphoAAVEPositionWrapper wrapper;

    /// @param config Configuration of this collateral. config.erc20 must be a MorphoAAVEPositionWrapper
    /// @param revenue_hiding {1} A value like 1e-6 that represents the maximum refPerTok to hide
    constructor(
        CollateralConfig memory config,
        uint192 revenue_hiding
    ) AppreciatingFiatCollateral(config, revenue_hiding) {
        require(config.defaultThreshold == 0, "default threshold not supported");
        require(address(config.erc20) != address(0), "missing erc20");
        wrapper = MorphoAAVEPositionWrapper(address(config.erc20));
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
        // {UoA/tok} = {UoA/ref} * {ref/tok}
        uint192 p = chainlinkFeed.price(oracleTimeout).mul(_underlyingRefPerTok());
        uint192 err = p.mul(oracleError, CEIL);

        low = p - err;
        high = p + err;
        // assert(low <= high); obviously true just by inspection

        pegPrice = targetPerRef();
    }

    /// Refresh exchange rates and update default status.
    /// @custom:interaction RCEI
    function refresh() public virtual override {
        // Update wrapper exchange rate for underlying token
        wrapper.refresh_exchange_rate();
        super.refresh();
    }

    /// @return {ref/tok} Actual quantity of whole reference units per whole collateral tokens
    function _underlyingRefPerTok() internal view override returns (uint192) {
        return wrapper.get_exchange_rate();
    }

    /// Claim rewards earned by holding a balance of the ERC20 token
    /// @dev delegatecall
    function claimRewards() external virtual override(Asset, IRewardable) {
        // unfortunately Morpho uses a rewards scheme that requires the results 
        // of off-chain computation to be piped into an on-chain function,
        // which is not possible to do with Reserve's collateral plugin interface.

        // https://integration.morpho.xyz/track-and-manage-position/manage-positions-on-morpho/claim-morpho-rewards

        // claiming rewards for this wrapper can be done by any account, and must be done on Morpho's rewards distributor contract
        // https://etherscan.io/address/0x3b14e5c73e0a56d607a8688098326fd4b4292135
    }
}
