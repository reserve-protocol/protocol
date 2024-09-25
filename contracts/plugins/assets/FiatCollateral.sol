// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "../../interfaces/IAsset.sol";
import "../../libraries/Fixed.sol";
import "./Asset.sol";
import "./OracleLib.sol";

uint48 constant MAX_DELAY_UNTIL_DEFAULT = 1209600; // {s} 2 weeks

struct CollateralConfig {
    uint48 priceTimeout; // {s} The number of seconds over which saved prices decay
    AggregatorV3Interface chainlinkFeed; // Feed units: {target/ref}
    uint192 oracleError; // {1} The % the oracle feed can be off by
    IERC20Metadata erc20; // The ERC20 of the collateral token
    uint192 maxTradeVolume; // {UoA} The max trade volume, in UoA
    uint48 oracleTimeout; // {s} The number of seconds until a oracle value becomes invalid
    bytes32 targetName; // The bytes32 representation of the target name
    uint192 defaultThreshold; // {1} A value like 0.05 that represents a deviation tolerance
    // set defaultThreshold to zero to create SelfReferentialCollateral
    uint48 delayUntilDefault; // {s} The number of seconds an oracle can mulfunction
}

/**
 * @title FiatCollateral
 * Parent class for all collateral. Can be extended to support appreciating collateral
 *
 * For: {tok} == {ref}, {ref} != {target}, {target} == {UoA}
 * Can be easily extended by (optionally) re-implementing:
 *   - tryPrice()
 *   - refPerTok()
 *   - targetPerRef()
 *   - claimRewards()
 * If you have appreciating collateral, then you should use AppreciatingFiatCollateral or
 * override refresh() yourself.
 *
 * Can intentionally disable default checks by setting config.defaultThreshold to 0
 */
contract FiatCollateral is ICollateral, Asset {
    using FixLib for uint192;
    using OracleLib for AggregatorV3Interface;

    // Default Status:
    // _whenDefault == NEVER: no risk of default (initial value)
    // _whenDefault > block.timestamp: delayed default may occur as soon as block.timestamp.
    //                In this case, the asset may recover, reachiving _whenDefault == NEVER.
    // _whenDefault <= block.timestamp: default has already happened (permanently)
    uint48 private constant NEVER = type(uint48).max;
    uint48 private _whenDefault = NEVER;

    uint48 public immutable delayUntilDefault; // {s} e.g 86400

    // targetName: The canonical name of this collateral's target unit.
    bytes32 public immutable targetName;

    uint192 public immutable pegBottom; // {target/ref} The bottom of the peg

    uint192 public immutable pegTop; // {target/ref} The top of the peg

    uint192 public savedPegPrice; // {target/ref} The peg price of the token during the last update

    /// @param config.chainlinkFeed Feed units: {UoA/ref}
    constructor(CollateralConfig memory config)
        Asset(
            config.priceTimeout,
            config.chainlinkFeed,
            config.oracleError,
            config.erc20,
            config.maxTradeVolume,
            config.oracleTimeout
        )
    {
        require(config.targetName != bytes32(0), "targetName missing");
        if (config.defaultThreshold != 0) {
            require(config.delayUntilDefault != 0, "delayUntilDefault zero");
        }
        require(config.delayUntilDefault <= 1209600, "delayUntilDefault too long");

        // Note: This contract is designed to allow setting defaultThreshold = 0 to disable
        // default checks. You can apply the check below to child contracts when required
        // require(config.defaultThreshold != 0, "defaultThreshold zero");

        targetName = config.targetName;
        delayUntilDefault = config.delayUntilDefault;

        // Cache constants
        uint192 peg = targetPerRef(); // {target/ref}

        // {target/ref} = {target/ref} * {1}
        uint192 delta = peg.mul(config.defaultThreshold);
        pegBottom = peg - delta;
        pegTop = peg + delta;
    }

    /// Can revert, used by other contract functions in order to catch errors
    /// Should not return FIX_MAX for low
    /// Should only return FIX_MAX for high if low is 0
    /// Should NOT be manipulable by MEV
    /// @dev Override this when pricing is more complicated than just a single oracle
    /// @return low {UoA/tok} The low price estimate
    /// @return high {UoA/tok} The high price estimate
    /// @return pegPrice {target/ref} The actual price observed in the peg
    function tryPrice()
        external
        view
        virtual
        override
        returns (
            uint192 low,
            uint192 high,
            uint192 pegPrice
        )
    {
        // {target/ref} = {UoA/ref} / {UoA/target} (1)
        pegPrice = chainlinkFeed.price(oracleTimeout);

        // {target/ref} = {target/ref} * {1}
        uint192 err = pegPrice.mul(oracleError, CEIL);

        low = pegPrice - err;
        high = pegPrice + err;
        // assert(low <= high); obviously true just by inspection
    }

    /// Should not revert
    /// Refresh exchange rates and update default status.
    /// @dev May need to override: limited to handling collateral with refPerTok() = 1
    function refresh() public virtual override(Asset, IAsset) {
        CollateralStatus oldStatus = status();

        // Check for soft default + save price
        try this.tryPrice() returns (uint192 low, uint192 high, uint192 pegPrice) {
            // {UoA/tok}, {UoA/tok}, {target/ref}
            // (0, 0) is a valid price; (0, FIX_MAX) is unpriced

            // Save prices if priced
            if (high != FIX_MAX) {
                savedLowPrice = low;
                savedHighPrice = high;
                savedPegPrice = pegPrice;
                lastSave = uint48(block.timestamp);
            } else {
                // must be unpriced
                assert(low == 0);
            }

            // If the price is below the default-threshold price, default eventually
            // uint192(+/-) is the same as Fix.plus/minus
            if (pegPrice < pegBottom || pegPrice > pegTop || low == 0) {
                markStatus(CollateralStatus.IFFY);
            } else {
                markStatus(CollateralStatus.SOUND);
            }
        } catch (bytes memory errData) {
            // see: docs/solidity-style.md#Catching-Empty-Data
            if (errData.length == 0) revert(); // solhint-disable-line reason-string
            markStatus(CollateralStatus.IFFY);
        }

        CollateralStatus newStatus = status();
        if (oldStatus != newStatus) {
            emit CollateralStatusChanged(oldStatus, newStatus);
        }
    }

    /// @return The collateral's status
    function status() public view returns (CollateralStatus) {
        if (_whenDefault == NEVER) {
            return CollateralStatus.SOUND;
        } else if (_whenDefault > block.timestamp) {
            return CollateralStatus.IFFY;
        } else {
            return CollateralStatus.DISABLED;
        }
    }

    // === Helpers for child classes ===

    function markStatus(CollateralStatus status_) internal {
        // untestable:
        //      All calls to markStatus happen exclusively if the collateral is not defaulted
        if (_whenDefault <= block.timestamp) return; // prevent DISABLED -> SOUND/IFFY

        if (status_ == CollateralStatus.SOUND) {
            _whenDefault = NEVER;
        } else if (status_ == CollateralStatus.IFFY) {
            uint256 sum = block.timestamp + uint256(delayUntilDefault);
            // untestable:
            //      constructor enforces max length on delayUntilDefault
            if (sum >= NEVER) _whenDefault = NEVER;
            else if (sum < _whenDefault) _whenDefault = uint48(sum);
            // else: no change to _whenDefault
            // untested:
            //      explicit `if` to check DISABLED. else branch will never be hit
        } else if (status_ == CollateralStatus.DISABLED) {
            _whenDefault = uint48(block.timestamp);
        }
    }

    function whenDefault() external view returns (uint256) {
        return _whenDefault;
    }

    // === End child helpers ===

    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    function refPerTok() public view virtual returns (uint192) {
        return FIX_ONE;
    }

    /// @return {target/ref} Quantity of whole target units per whole reference unit in the peg
    function targetPerRef() public view virtual returns (uint192) {
        return FIX_ONE;
    }

    /// @return If the asset is an instance of ICollateral or not
    function isCollateral() external pure virtual override(Asset, IAsset) returns (bool) {
        return true;
    }
}
