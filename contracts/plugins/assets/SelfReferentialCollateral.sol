// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "contracts/plugins/assets/AbstractCollateral.sol";

/**
 * @title SelfReferentialCollateral
 * @notice Self-referential collateral is collateral where {target} == {ref} == {tok}
 * Such as:
 *   - WETH
 *   - COMP
 *   - MKR
 *   - ...
 *
 * Self-referential collateral cannot default, though it can become UNPRICED.
 */
contract SelfReferentialCollateral is Collateral {
    using OracleLib for AggregatorV3Interface;

    /// @param chainlinkFeed_ Feed units: {UoA/ref}
    /// @param tradingRange_ {tok} The min and max of the trading range for this asset
    /// @param oracleTimeout_ {s} The number of seconds until a oracle value becomes invalid
    // solhint-disable no-empty-blocks
    constructor(
        AggregatorV3Interface chainlinkFeed_,
        IERC20Metadata erc20_,
        IERC20Metadata rewardERC20_,
        TradingRange memory tradingRange_,
        uint48 oracleTimeout_,
        bytes32 targetName_
    )
        Collateral(chainlinkFeed_, erc20_, rewardERC20_, tradingRange_, oracleTimeout_, targetName_)
    {}

    // solhint-enable no-empty-blocks

    /// @return {UoA/target} The price of a target unit in UoA
    function pricePerTarget() public view virtual override returns (uint192) {
        return chainlinkFeed.price(oracleTimeout);
    }

    /// @return min {tok} The minimium trade size
    function minTradeSize() external view virtual override returns (uint192 min) {
        try chainlinkFeed.price_(oracleTimeout) returns (uint192 p) {
            // {tok} = {UoA} / {UoA/tok}
            // return tradingRange.minVal.div(p, CEIL);
            uint256 min256 = (FIX_ONE_256 * tradingRange.minVal + p - 1) / p;
            if (type(uint192).max < min256) revert UIntOutOfBounds();
            min = uint192(min256);
        } catch {}
        if (min < tradingRange.minAmt) min = tradingRange.minAmt;
        if (min > tradingRange.maxAmt) min = tradingRange.maxAmt;
    }

    /// @return max {tok} The maximum trade size
    function maxTradeSize() external view virtual override returns (uint192 max) {
        try chainlinkFeed.price_(oracleTimeout) returns (uint192 p) {
            // {tok} = {UoA} / {UoA/tok}
            // return tradingRange.maxVal.div(p);
            uint256 max256 = (FIX_ONE_256 * tradingRange.maxVal) / p;
            if (type(uint192).max < max256) revert UIntOutOfBounds();
            max = uint192(max256);
        } catch {}
        if (max == 0 || max > tradingRange.maxAmt) max = tradingRange.maxAmt;
        if (max < tradingRange.minAmt) max = tradingRange.minAmt;
    }
}
