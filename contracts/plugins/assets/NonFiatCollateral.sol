// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/plugins/assets/AbstractCollateral.sol";

/**
 * @title NonFiatCollateral
 * @notice Collateral plugin for a nonfiat collateral that requires default checks, such as WBTC
 */
contract NonFiatCollateral is Collateral {
    using FixLib for uint192;
    using OracleLib for AggregatorV3Interface;

    /// Should not use Collateral.chainlinkFeed, since naming is ambiguous

    AggregatorV3Interface public immutable targetUnitUSDChainlinkFeed;
    AggregatorV3Interface public immutable refUnitChainlinkFeed;

    // Default Status:
    // whenDefault == NEVER: no risk of default (initial value)
    // whenDefault > block.timestamp: delayed default may occur as soon as block.timestamp.
    //                In this case, the asset may recover, reachiving whenDefault == NEVER.
    // whenDefault <= block.timestamp: default has already happened (permanently)
    uint256 internal constant NEVER = type(uint256).max;
    uint256 public whenDefault = NEVER;

    uint192 public immutable defaultThreshold; // {%} e.g. 0.05

    uint256 public immutable delayUntilDefault; // {s} e.g 86400

    /// @param refUnitChainlinkFeed_ Feed units: {target/ref}
    /// @param targetUnitUSDChainlinkFeed_ Feed units: {UoA/target}
    /// @param maxTradeVolume_ {UoA} The max amount of value to trade in an indivudual trade
    /// @param oracleTimeout_ {s} The number of seconds until a oracle value becomes invalid
    /// @param defaultThreshold_ {%} A value like 0.05 that represents a deviation tolerance
    /// @param delayUntilDefault_ {s} The number of seconds deviation must occur before default
    constructor(
        AggregatorV3Interface refUnitChainlinkFeed_,
        AggregatorV3Interface targetUnitUSDChainlinkFeed_,
        IERC20Metadata erc20_,
        IERC20Metadata rewardERC20_,
        uint192 maxTradeVolume_,
        uint32 oracleTimeout_,
        bytes32 targetName_,
        uint192 defaultThreshold_,
        uint256 delayUntilDefault_
    )
        Collateral(
            AggregatorV3Interface(address(1)),
            erc20_,
            rewardERC20_,
            maxTradeVolume_,
            oracleTimeout_,
            targetName_
        )
    {
        require(defaultThreshold_ > 0, "defaultThreshold zero");
        require(delayUntilDefault_ > 0, "delayUntilDefault zero");
        require(address(refUnitChainlinkFeed_) != address(0), "missing ref unit chainlink feed");
        require(
            address(targetUnitUSDChainlinkFeed_) != address(0),
            "missing target unit chainlink feed"
        );
        defaultThreshold = defaultThreshold_;
        delayUntilDefault = delayUntilDefault_;
        targetUnitUSDChainlinkFeed = targetUnitUSDChainlinkFeed_;
        refUnitChainlinkFeed = refUnitChainlinkFeed_;
    }

    /// @return {UoA/tok} Our best guess at the market price of 1 whole token in UoA
    function price() public view virtual override returns (uint192) {
        // {UoA/tok} = {UoA/target} * {target/ref} * {ref/tok} (1)
        return
            targetUnitUSDChainlinkFeed.price(oracleTimeout).mul(
                refUnitChainlinkFeed.price(oracleTimeout)
            );
    }

    /// Refresh exchange rates and update default status.
    /// @dev This default check assumes that the collateral's price() value is expected
    /// to stay close to pricePerTarget() * targetPerRef(). If that's not true for the
    /// collateral you're defining, you MUST redefine refresh()!!
    function refresh() external virtual override {
        if (whenDefault <= block.timestamp) return;
        CollateralStatus oldStatus = status();

        // p {target/ref}
        try refUnitChainlinkFeed.price_(oracleTimeout) returns (uint192 p) {
            // We don't need the return value from this next feed, but it should still function
            try targetUnitUSDChainlinkFeed.price_(oracleTimeout) returns (uint192) {
                priceable = true;

                // {target/ref}
                uint192 peg = targetPerRef();
                uint192 delta = (peg * defaultThreshold) / FIX_ONE;

                // If the price is below the default-threshold price, default eventually
                if (p < peg - delta || p > peg + delta) {
                    whenDefault = Math.min(block.timestamp + delayUntilDefault, whenDefault);
                } else whenDefault = NEVER;
            } catch {
                priceable = false;
            }
        } catch {
            priceable = false;
        }

        CollateralStatus newStatus = status();
        if (oldStatus != newStatus) {
            emit DefaultStatusChanged(oldStatus, newStatus);
        }
    }

    /// @return The collateral's status
    function status() public view virtual override returns (CollateralStatus) {
        if (whenDefault == NEVER) {
            return priceable ? CollateralStatus.SOUND : CollateralStatus.UNPRICED;
        } else if (whenDefault > block.timestamp) {
            return priceable ? CollateralStatus.IFFY : CollateralStatus.UNPRICED;
        } else {
            return CollateralStatus.DISABLED;
        }
    }

    /// @return {UoA/target} The price of a target unit in UoA
    function pricePerTarget() public view override returns (uint192) {
        return targetUnitUSDChainlinkFeed.price(oracleTimeout);
    }
}
