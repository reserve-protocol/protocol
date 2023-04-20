// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "../../interfaces/IAsset.sol";
import "../../libraries/Fixed.sol";
import "./Asset.sol";
import "./OracleLib.sol";

uint48 constant MAX_DELAY_UNTIL_DEFAULT = 1209600; // {s} 2 weeks

struct CollateralConfig {
    uint48 priceTimeout; // {s} The number of seconds over which saved prices decay
    AggregatorV3Interface uoaPerTargetOracle; // Feed units: {UoA/ref}
    AggregatorV3Interface uoaPerRefOracle; // Feed units: {UoA/ref}
    uint192 oracleError; // {1} The % the oracle feed can be off by
    IERC20Metadata erc20; // The ERC20 of the collateral token
    uint192 maxTradeVolume; // {UoA} The max trade volume, in UoA
    uint48 uoaPerTargetOracleTimeout; // {s} The number of seconds until a oracle value becomes invalid
    uint48 uoaPerRefOracleTimeout; // {s} The number of seconds until a oracle value becomes invalid
    bytes32 targetName; // The bytes32 representation of the target name
    uint192 defaultThreshold; // {1} A value like 0.05 that represents a deviation tolerance
    // set defaultThreshold to zero to create SelfReferentialCollateral
    uint48 delayUntilDefault; // {s} The number of seconds an oracle can mulfunction
}

/**
 * @title Collateral
 * Parent class for all collateral. Can be extended to support appreciating collateral
 *
 * For: {tok} == {ref}, {ref} != {target}, {target} == {UoA}
 * Can be easily extended by (optionally) re-implementing:
 *   - tryPrice()
 *   - refPerTok()
 *   - targetPerRef()
 *   - claimRewards()
 * If you have appreciating collateral, then you should use AppreciatingCollateral or
 * override refresh() yourself.
 *
 * Can intentionally disable default checks by setting config.defaultThreshold to 0
 */
contract Collateral is ICollateral, Asset {
    using FixLib for uint192;
    using OracleLib for AggregatorV3Interface;

    AggregatorV3Interface public immutable uoaPerTargetOracle; // {UoA/ref}
    uint48 public immutable uoaPerTargetOracleTimeout; // {s}

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

    /// @param config.uoaPerRefOracle Feed units: {UoA/ref}
    constructor(CollateralConfig memory config)
        Asset(
            config.priceTimeout,
            config.uoaPerRefOracle,
            config.oracleError,
            config.erc20,
            config.maxTradeVolume,
            config.uoaPerRefOracleTimeout
        )
    {
        require(config.targetName != bytes32(0), "targetName missing");
        if(address(config.uoaPerTargetOracle) != address(0)) {
            require(config.uoaPerTargetOracleTimeout > 0, "uoaPerTargetOracleTimeout zero");
        }
        if (config.defaultThreshold > 0) {
            require(config.delayUntilDefault > 0, "delayUntilDefault zero");
        }
        require(config.delayUntilDefault <= 1209600, "delayUntilDefault too long");

        targetName = config.targetName;
        delayUntilDefault = config.delayUntilDefault;
        uoaPerTargetOracle = config.uoaPerTargetOracle;
        uoaPerTargetOracleTimeout = config.uoaPerTargetOracleTimeout;

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
    /// @dev Override this when pricing is more complicated than just a single oracle
    /// @return low {UoA/tok} The low price estimate
    /// @return high {UoA/tok} The high price estimate
    /// @return pegPrice {target/ref} The actual price observed in the peg
    function tryPrice()
        public
        view
        virtual
        override
        returns (
            uint192 low,
            uint192 high,
            uint192 pegPrice
        )
    {
        // {UoA/target}
        uint192 _uoaPerTarget = uoaPerTarget();
        if (address(uoaPerTargetOracle) != address(0)) {
            _uoaPerTarget = uoaPerTargetOracle.price(uoaPerTargetOracleTimeout);
        }

        // {UoA/ref} = {UoA/target} * {target/ref}
        uint192 _uoaPerRef = _uoaPerTarget.mul(targetPerRef());
        if (address(uoaPerRefOracle) != address(0)) {
            _uoaPerRef = uoaPerRefOracle.price(uoaPerRefOracleTimeout); // {UoA/ref}
        }

        if (_uoaPerTarget == 0) {
            return (0, FIX_MAX, 0);
        } else {
            // this oracleError is already the combined total oracle error
            uint192 err = _uoaPerRef.mul(oracleError, CEIL);

            // assert(low <= high); obviously true just by inspection
            low = _uoaPerRef - err;
            high = _uoaPerRef + err;

            // {target/ref} = {UoA/ref} / {UoA/target}
            pegPrice = _uoaPerRef.div(_uoaPerTarget);
        }
    }

    /// Should not revert
    /// Refresh exchange rates and update default status.
    /// @dev May need to override: limited to handling collateral with refPerTok() = 1
    function refresh() public virtual override(Asset, IAsset) {
        if (alreadyDefaulted()) return;
        CollateralStatus oldStatus = status();

        // Check for soft default + save lotPrice
        try this.tryPrice() returns (uint192 low, uint192 high, uint192 pegPrice) {
            // {UoA/tok}, {UoA/tok}, {target/ref}
            // (0, 0) is a valid price; (0, FIX_MAX) is unpriced

            // Save prices if priced
            if (high < FIX_MAX) {
                savedLowPrice = low;
                savedHighPrice = high;
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

    function alreadyDefaulted() internal view returns (bool) {
        return _whenDefault <= block.timestamp;
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

    /// @return {uoa/target} Quantity of whole account units per whole target unit
    function uoaPerTarget() public view virtual returns (uint192) {
        return FIX_ONE;
    }

    /// @return If the asset is an instance of ICollateral or not
    function isCollateral() external pure virtual override(Asset, IAsset) returns (bool) {
        return true;
    }
}
