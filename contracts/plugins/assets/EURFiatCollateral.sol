// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/plugins/assets/AbstractCollateral.sol";

/**
 * @title EURFiatCollateral
 * @notice Collateral plugin for a EURO fiatcoin collateral, like EURT
 * Expected: {tok} == {ref}, {ref} is pegged to {target} or defaults, {target} != {UoA}
 */
contract EURFiatCollateral is Collateral {
    using FixLib for uint192;
    using OracleLib for AggregatorV3Interface;

    AggregatorV3Interface public immutable uoaPerTargetFeed; // {UoA/target}

    uint192 public immutable defaultThreshold; // {%} e.g. 0.05

    uint192 public immutable uoaPerTargetOracleError; // {1} The max % error, target unit oracle

    /// @param fallbackPrice_ {UoA/tok} A fallback price to use for lot sizing when oracles fail
    /// @param uoaPerRefFeed_ {UoA/ref}
    /// @param uoaPerTargetFeed_ {UoA/target}
    /// @param maxTradeVolume_ {UoA} The max trade volume, in UoA
    /// @param oracleTimeout_ {s} The number of seconds until a oracle value becomes invalid
    /// @param defaultThreshold_ {%} A value like 0.05 that represents a deviation tolerance
    /// @param delayUntilDefault_ {s} The number of seconds deviation must occur before default
    constructor(
        uint192 fallbackPrice_,
        AggregatorV3Interface uoaPerRefFeed_,
        uint192 uoaPerRefOracleError_,
        AggregatorV3Interface uoaPerTargetFeed_,
        uint192 uoaPerTargetOracleError_,
        IERC20Metadata erc20_,
        uint192 maxTradeVolume_,
        uint48 oracleTimeout_,
        bytes32 targetName_,
        uint192 defaultThreshold_,
        uint256 delayUntilDefault_
    )
        Collateral(
            fallbackPrice_,
            uoaPerRefFeed_,
            uoaPerRefOracleError_,
            erc20_,
            maxTradeVolume_,
            oracleTimeout_,
            targetName_,
            delayUntilDefault_
        )
    {
        require(defaultThreshold_ > 0, "defaultThreshold zero");
        require(address(uoaPerTargetFeed_) != address(0), "missing uoaPerTarget feed");
        defaultThreshold = defaultThreshold_;
        uoaPerTargetFeed = uoaPerTargetFeed_;
        uoaPerTargetOracleError = uoaPerTargetOracleError_;
    }

    /// Should not revert
    /// @return low {UoA/tok} The lower end of the price estimate
    /// @return high {UoA/tok} The upper end of the price estimate
    function price() public view virtual returns (uint192 low, uint192 high) {
        try chainlinkFeed.price_(oracleTimeout) returns (uint192 p) {
            // {UoA/tok} = {UoA/tok} * {1}
            uint192 priceErr = p.mul(oracleError);
            return (p - priceErr, p + priceErr);
        } catch {
            return (0, FIX_MAX);
        }
    }

    /// Refresh exchange rates and update default status.
    /// @dev This default check assumes that the collateral's price() value is expected
    /// to stay close to pricePerTarget() * targetPerRef(). If that's not true for the
    /// collateral you're defining, you MUST redefine refresh()!!
    function refresh() external virtual override {
        if (alreadyDefaulted()) return;
        CollateralStatus oldStatus = status();

        // p1 {UoA/ref}
        try chainlinkFeed.price_(oracleTimeout) returns (uint192 p1) {
            // We don't need the return value from this next feed, but it should still function
            // p2 {UoA/target}
            try uoaPerTargetFeed.price_(oracleTimeout) returns (uint192 p2) {
                if (p2 > 0) {
                    // {target/ref}
                    uint192 peg = targetPerRef();

                    // D18{target/ref}= D18{target/ref} * D18{1} / D18
                    uint192 delta = (peg * defaultThreshold) / FIX_ONE;

                    // {target/ref} = {UoA/ref} / {UoA/target}
                    uint192 p = p1.div(p2);

                    // If the price is below the default-threshold price, default eventually
                    if (p < peg - delta || p > peg + delta) markStatus(CollateralStatus.IFFY);
                    else {
                        // {UoA/tok} = {UoA/tok}
                        _fallbackPrice = p1;

                        markStatus(CollateralStatus.SOUND);
                    }
                } else {
                    markStatus(CollateralStatus.IFFY);
                }
            } catch (bytes memory errData) {
                // see: docs/solidity-style.md#Catching-Empty-Data
                if (errData.length == 0) revert(); // solhint-disable-line reason-string
                markStatus(CollateralStatus.IFFY);
            }
        } catch (bytes memory errData) {
            // see: docs/solidity-style.md#Catching-Empty-Data
            if (errData.length == 0) revert(); // solhint-disable-line reason-string
            markStatus(CollateralStatus.IFFY);
        }

        CollateralStatus newStatus = status();
        if (oldStatus != newStatus) {
            emit DefaultStatusChanged(oldStatus, newStatus);
        }
    }

    /// @return {UoA/target} The price of a target unit in UoA
    function pricePerTarget() internal view override returns (uint192) {
        return uoaPerTargetFeed.price(oracleTimeout);
    }
}
