// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import { FixLib, shiftl_toFix } from "contracts/libraries/Fixed.sol";
import { AggregatorV3Interface, OracleLib } from "contracts/plugins/assets/OracleLib.sol";
import { IERC20, IRewardable, Asset, CollateralConfig, AppreciatingFiatCollateral } from "contracts/plugins/assets/AppreciatingFiatCollateral.sol";
import { IPoolToken } from "contracts/plugins/assets/bancor-v3/vendor/IPoolToken.sol";
import { IPoolCollection } from "contracts/plugins/assets/bancor-v3/vendor/IPoolCollection.sol";
import { IStandardRewards } from "contracts/plugins/assets/bancor-v3/vendor/IStandardRewards.sol";

/**
 * @title BnTokenFiatCollateral
 * @notice Collateral plugin for the token given to the liquidity providers
 * These tokens have symbols like "bnETH" and come from the contract PoolToken.sol
 * {tok} = bnXYZ
 * {ref} = XYZ, any fiat token
 * {target} = USD
 * {UoA} = USD
 */
contract BnTokenFiatCollateral is AppreciatingFiatCollateral {
    using FixLib for uint192;
    using OracleLib for AggregatorV3Interface;

    // The logic of the pools is not in the token contract, but in the collection contract
    IPoolCollection public poolCollection; // NOT a proxy; it may change!
    IStandardRewards public standardRewards; // proxy

    // The Bancor v3 tokens have the same number of decimals than their underlying

    /// @param config.chainlinkFeed Feed units: {UoA/ref} = {target/ref}
    /// @param poolCollection_ The address of the collection corresponding to the pool
    /// @param standardRewards_ The address of the collection corresponding to the pool
    /// @param revenueHiding {1} A value like 1e-6 that represents the maximum refPerTok to hide
    constructor(
        CollateralConfig memory config,
        IPoolCollection poolCollection_,
        IStandardRewards standardRewards_,
        uint192 revenueHiding
    ) AppreciatingFiatCollateral(config, revenueHiding) {
        require(address(poolCollection_) != address(0), "missing pool collection");
        require(address(standardRewards_) != address(0), "missing standard rewards");
        poolCollection = poolCollection_;
        standardRewards = standardRewards_;
    }

    /// Refresh exchange rates and update default status.
    /// @custom:interaction RCEI
    function refresh() public virtual override {
        super.refresh(); // already handles all necessary default checks
    }

    /// @return {ref/tok} Actual quantity of whole reference units per whole collateral tokens
    /// @dev does not take the withdrawing fees into account on purpose, see README
    function _underlyingRefPerTok() internal view override returns (uint192) {
        uint256 rate = poolCollection.poolTokenToUnderlying(
            IPoolToken(address(erc20)).reserveToken(), // pools are indexed by their underlying token
            uint256(1e18));
        return shiftl_toFix(rate, -18); // convert to uint192 and actually keep the same value
    }

    /// Bancor pools hand out BNT rewards
    /// Only pools selected by the DAO benefit from rewards
    function claimRewards() external virtual override(Asset, IRewardable) {
        uint256 claimed = 0; // not all pools are eligible for rewards
        uint256 id = standardRewards.latestProgramId(IPoolToken(address(erc20)).reserveToken());
        if (id > 0) {
            uint256[] memory ids = new uint256[](1);
            ids[0] = id;
            claimed = standardRewards.claimRewards(ids);
        }
        emit RewardsClaimed(IERC20(0x1F573D6Fb3F13d689FF844B4cE37794d79a7FF1C), claimed); // BNT token address
    }
}
