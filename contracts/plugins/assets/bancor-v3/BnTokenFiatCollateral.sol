// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import { FixLib, shiftl_toFix } from "contracts/libraries/Fixed.sol";
import { AggregatorV3Interface, OracleLib } from "contracts/plugins/assets/OracleLib.sol";
import { IRewardable, Asset, CollateralConfig, AppreciatingFiatCollateral } from "contracts/plugins/assets/AppreciatingFiatCollateral.sol";
import { IBnToken } from "contracts/plugins/assets/bancor-v3/vendor/IBnToken.sol";
import { IPoolCollection } from "contracts/plugins/assets/bancor-v3/vendor/IPoolCollection.sol";

/**
 * @title BnTokenFiatCollateral
 * @notice Collateral plugin for the token given to the liquidity providers
 * {tok} = bnXYZ
 * {ref} = XYZ, any fiat token
 * {target} = USD
 * {UoA} = USD
 */
contract BnTokenFiatCollateral is AppreciatingFiatCollateral {
    using FixLib for uint192;
    using OracleLib for AggregatorV3Interface;

    // The logic of the pools is not in the token contract, but in the collection contract
    IPoolCollection public poolCollection;

    // The Bancor v3 tokens have the same number of decimals than their underlying

    /// @param config.chainlinkFeed Feed units: {UoA/ref} = {target/ref}
    /// @param poolCollection_ The address of the collection corresponding to the pool
    /// @param revenueHiding {1} A value like 1e-6 that represents the maximum refPerTok to hide
    constructor(CollateralConfig memory config, IPoolCollection poolCollection_, uint192 revenueHiding) AppreciatingFiatCollateral(config, revenueHiding) {
        require(address(poolCollection_) != address(0), "missing pool collection");
        poolCollection = poolCollection_;
    }

    /// Refresh exchange rates and update default status.
    /// @custom:interaction RCEI
    function refresh() public virtual override {
        super.refresh(); // already handles all necessary default checks
    }

    /// @return {ref/tok} Actual quantity of whole reference units per whole collateral tokens
    function _underlyingRefPerTok() internal view override returns (uint192) {
        uint256 rate = poolCollection.poolTokenToUnderlying(
            IBnToken(erc20).reserveToken(),
            uint256(1e18));
        return shiftl_toFix(rate, -18); // convert to uint192 and actually keep the same value
    }

    /// Bancor pools hand out BNT rewards
    /// Only pools selected by the DAO benefit from rewards
    function claimRewards() external virtual override(Asset, IRewardable) {}
}
