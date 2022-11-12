// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "contracts/plugins/assets/AbstractCollateral.sol";

/**
 * @title SelfReferentialCollateral
 * @notice Collateral plugin for collateral that is its own target and reference unit,
 * like COMP, MKR, etc.
 * Expected: {tok} == {ref} == {target}, and {target} is probably not {UoA}
 * Self-referential collateral can default if the oracle becomes stale for long enough.
 */
contract SelfReferentialCollateral is Collateral {
    using OracleLib for AggregatorV3Interface;

    /// @param chainlinkFeed_ Feed units: {UoA/ref}
    /// @param maxTradeVolume_ {UoA} The max trade volume, in UoA
    /// @param oracleTimeout_ {s} The number of seconds until a oracle value becomes invalid
    // solhint-disable no-empty-blocks
    constructor(
        uint192 fallbackPrice_,
        AggregatorV3Interface chainlinkFeed_,
        IERC20Metadata erc20_,
        uint192 maxTradeVolume_,
        uint48 oracleTimeout_,
        bytes32 targetName_,
        uint256 delayUntilDefault_
    )
        Collateral(
            fallbackPrice_,
            chainlinkFeed_,
            erc20_,
            maxTradeVolume_,
            oracleTimeout_,
            targetName_,
            delayUntilDefault_
        )
    {}

    // solhint-enable no-empty-blocks

    /// @return {UoA/target} The price of a target unit in UoA
    function pricePerTarget() public view virtual override returns (uint192) {
        return chainlinkFeed.price(oracleTimeout);
    }
}
