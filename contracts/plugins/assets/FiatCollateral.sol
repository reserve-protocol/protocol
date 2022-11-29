// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/plugins/assets/AbstractCollateral.sol";

/**
 * @title FiatCollateral
 * @notice Such as USDC, DAI, USDT, but also EUR stablecoins
 * Expected: {tok} == {ref}, {ref} is pegged to {target} or defaults, {target} == {UoA}
 */
contract FiatCollateral is Collateral {
    using FixLib for uint192;
    using OracleLib for AggregatorV3Interface;

    uint192 public immutable defaultThreshold; // {%} e.g. 0.05

    uint192 public immutable pegBottom; // {UoA/ref} The bottom of the peg

    uint192 public immutable pegTop; // {UoA/ref} The top of the peg

    /// @param fallbackPrice_ {UoA/tok} A fallback price to use for lot sizing when oracles fail
    /// @param chainlinkFeed_ Feed units: {UoA/ref}
    /// @param oracleError_ {1} The % the oracle feed can be off by
    /// @param maxTradeVolume_ {UoA} The max trade volume, in UoA
    /// @param oracleTimeout_ {s} The number of seconds until a oracle value becomes invalid
    /// @param defaultThreshold_ {%} A value like 0.05 that represents a deviation tolerance
    /// @param delayUntilDefault_ {s} The number of seconds deviation must occur before default
    constructor(
        uint192 fallbackPrice_,
        AggregatorV3Interface chainlinkFeed_,
        uint192 oracleError_,
        IERC20Metadata erc20_,
        uint192 maxTradeVolume_,
        uint48 oracleTimeout_,
        bytes32 targetName_,
        uint192 defaultThreshold_,
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
    {
        require(defaultThreshold_ > 0, "defaultThreshold zero");
        defaultThreshold = defaultThreshold_;

        // Set up cached constants
        uint192 peg = FIX_ONE; // D18{UoA/ref}

        // D18{UoA/ref}= D18{UoA/ref} * D18{1} / D18
        uint192 delta = (peg * defaultThreshold) / FIX_ONE; // D18{UoA/ref}
        pegBottom = peg - delta;
        pegTop = peg + delta;
    }

    /// Should not revert
    /// @param low {UoA/tok} The low price estimate
    /// @param high {UoA/tok} The high price estimate
    /// @param chainlinkFeedPrice {UoA/ref}
    function _price()
        internal
        view
        override
        returns (uint192 low, uint192 high, uint192 chainlinkFeedPrice)
    {
        try chainlinkFeed.price_(oracleTimeout) returns (uint192 p1) {
            // {UoA/tok} = {UoA/ref} * {ref/tok}
            uint192 p = p1.mul(refPerTok());

            // oracleError is on whatever the _true_ price is, not the one observed
            low = p.div(FIX_ONE.plus(oracleError));
            high = p.div(FIX_ONE.minus(oracleError));
            chainlinkFeedPrice = p1; // {UoA/ref}
        } catch (bytes memory errData) {
            // see: docs/solidity-style.md#Catching-Empty-Data
            if (errData.length == 0) revert(); // solhint-disable-line reason-string
            high = FIX_MAX;
        }
    }

    /// Should not revert
    /// @return low {UoA/tok} The lower end of the price estimate
    /// @return high {UoA/tok} The upper end of the price estimate
    function price() public view returns (uint192 low, uint192 high) {
        (low, high, ) = _price();
    }

    /// Refresh exchange rates and update default status.
    /// @dev This default check assumes that the collateral's price() value is expected
    /// to stay close to pricePerTarget() * targetPerRef(). If that's not true for the
    /// collateral you're defining, you MUST redefine refresh()!!
    function refresh() external virtual override {
        if (alreadyDefaulted()) return;
        CollateralStatus oldStatus = status();

        (uint192 low, , uint192 p) = _price(); // {UoA/tok}, {UoA}

        // If the price is below the default-threshold price, default eventually
        // uint192(+/-) is the same as Fix.plus/minus
        if (low == 0 || p < pegBottom || p > pegTop) markStatus(CollateralStatus.IFFY);
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
