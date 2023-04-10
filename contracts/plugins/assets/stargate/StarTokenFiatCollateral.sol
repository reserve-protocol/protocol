// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "../../../libraries/Fixed.sol";
import "../AppreciatingFiatCollateral.sol";
import "./IPool.sol";

/**
 * @title StarTokenFiatCollateral
 * @notice Collateral plugin for a stargate LP Token of fiat collateral, like S*USDC or S*USDT
 * Expected: {tok} != {ref}, {ref} is pegged to {target} unless defaulting, {target} == {UoA}
 */
contract StarTokenFiatCollateral is AppreciatingFiatCollateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    // All stargate LP tokens have the same decimals as their underlying

    IPool public immutable pool;

    /// @param config Collateral configuration. Pass in the pool address as the ERC20 address.
    /// These can be found at https://stargateprotocol.gitbook.io/stargate/developers/contract-addresses/mainnet
    /// @param revenueHiding Revenue hiding factor
    constructor(
        CollateralConfig memory config,
        uint192 revenueHiding
    ) AppreciatingFiatCollateral(config, revenueHiding) {
        pool = IPool(address(config.erc20));
    }

    /// Refresh exchange rates and update default status.
    /// @custom:interaction RCEI
    function refresh() public virtual override {
        // == Refresh ==

        // Intentional and correct for the super call to be last!
        super.refresh(); // already handles all necessary default checks
    }

    /// @return {ref/tok} Actual quantity of whole reference units per whole collateral tokens
    function _underlyingRefPerTok() internal view override returns (uint192) {
        return toFix(pool.totalLiquidity()).div(toFix(pool.totalSupply()));
    }

    /// Claim rewards earned by holding a balance of the ERC20 token
    /// @dev delegatecall
    function claimRewards() external virtual override(Asset, IRewardable) {
        // Stargate does not distribute rewards to liquidity pools
    }
}
