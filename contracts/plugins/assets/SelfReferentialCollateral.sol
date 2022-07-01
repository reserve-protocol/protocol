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
 * Self-referential collateral cannot default
 */
contract SelfReferentialCollateral is Collateral {
    using OracleLib for AggregatorV3Interface;

    /// @param maxTradeVolume_ {UoA} The max amount of value to trade in an indivudual trade
    /// @param oracleTimeout_ {s} The number of seconds until a oracle value becomes invalid
    // solhint-disable no-empty-blocks
    constructor(
        AggregatorV3Interface chainlinkFeed_,
        IERC20Metadata erc20_,
        uint192 maxTradeVolume_,
        uint32 oracleTimeout_,
        bytes32 targetName_
    ) Collateral(chainlinkFeed_, erc20_, maxTradeVolume_, oracleTimeout_, targetName_) {}

    // solhint-enable no-empty-blocks

    /// @return {UoA/target} The price of a target unit in UoA
    function pricePerTarget() public view virtual override returns (uint192) {
        return chainlinkFeed.price(oracleTimeout);
    }
}
