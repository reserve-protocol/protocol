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

    /// @param fallbackPrice_ {UoA/tok} A fallback price to use for lot sizing when oracles fail
    /// @param chainlinkFeed_ Feed units: {UoA/ref}
    /// @param oracleError_ {1} The % the oracle feed can be off by
    /// @param maxTradeVolume_ {UoA} The max trade volume, in UoA
    /// @param oracleTimeout_ {s} The number of seconds until a oracle value becomes invalid
    // solhint-disable no-empty-blocks
    constructor(
        uint192 fallbackPrice_,
        AggregatorV3Interface chainlinkFeed_,
        uint192 oracleError_,
        IERC20Metadata erc20_,
        uint192 maxTradeVolume_,
        uint48 oracleTimeout_,
        bytes32 targetName_,
        uint256 delayUntilDefault_
    )
        Collateral(
            fallbackPrice_,
            chainlinkFeed_,
            oracleError_,
            erc20_,
            maxTradeVolume_,
            oracleTimeout_,
            targetName_,
            delayUntilDefault_
        )
    {}

    // solhint-enable no-empty-blocks

    /// Refresh exchange rates and update default status.
    /// @dev This default check assumes that the collateral's price() value is expected
    /// to stay close to pricePerTarget() * targetPerRef(). If that's not true for the
    /// collateral you're defining, you MUST redefine refresh()!!
    function refresh() external virtual override {
        if (alreadyDefaulted()) return;
        CollateralStatus oldStatus = status();

        (uint192 low, , ) = _price(); // {UoA/tok}

        // If the price is below the default-threshold price, default eventually
        // uint192(+/-) is the same as Fix.plus/minus
        if (low == 0) markStatus(CollateralStatus.IFFY);
        else {
            _fallbackPrice = low;
            markStatus(CollateralStatus.SOUND);
        }

        CollateralStatus newStatus = status();
        if (oldStatus != newStatus) {
            emit DefaultStatusChanged(oldStatus, newStatus);
        }
    }
}
