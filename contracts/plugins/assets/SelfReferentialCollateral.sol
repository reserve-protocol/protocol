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
}
