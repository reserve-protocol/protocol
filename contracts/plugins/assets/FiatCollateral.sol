// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "../../interfaces/IAsset.sol";
import "../../libraries/Fixed.sol";
import "./FiatCollateral.sol";
import "./Asset.sol";
import "./OracleLib.sol";

struct CollateralConfig {
    uint192 fallbackPrice; // {UoA/tok} A fallback price to use for lot sizing when oracles fail
    AggregatorV3Interface chainlinkFeed; // Feed units: {target/ref}
    uint192 oracleError; // {1} The % the oracle feed can be off by
    IERC20Metadata erc20; // The ERC20 of the collateral token
    uint192 maxTradeVolume; // {UoA} The max trade volume, in UoA
    uint48 oracleTimeout; // {s} The number of seconds until a oracle value becomes invalid
    bytes32 targetName; // The bytes32 representation of the target name
    uint192 defaultThreshold; // {1} A value like 0.05 that represents a deviation tolerance
    // set defaultThreshold to zero to create SelfReferentialCollateral
    uint256 delayUntilDefault; // {s} The number of seconds an oracle can mulfunction
}

/**
 * @title FiatCollateral
 * Parent class for all collateral. Can be extended to support changing refPerToks or non-fiat
 *
 * For: {tok} == {ref}, {ref} != {target}, {target} == {UoA}
 * Can be easily extended by (optionally) re-implementing:
 *   - refresh()
 *   - tryPrice()
 *   - refPerTok()
 *   - targetPerRef()
 *   - claimRewards()
 * Should not have to re-implement any other methods.
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
    uint256 private constant NEVER = type(uint256).max;
    uint256 private _whenDefault = NEVER;

    uint256 public immutable delayUntilDefault; // {s} e.g 86400

    // targetName: The canonical name of this collateral's target unit.
    bytes32 public immutable targetName;

    uint192 public immutable pegBottom; // {target/ref} The bottom of the peg

    uint192 public immutable pegTop; // {target/ref} The top of the peg

    // does not become nonzero until after first refresh()
    uint192 public prevReferencePrice; // previous rate, {ref/tok}

    /// @param config.chainlinkFeed Feed units: {UoA/ref}
    constructor(
        CollateralConfig memory config
    )
        Asset(
            config.fallbackPrice,
            config.chainlinkFeed,
            config.oracleError,
            config.erc20,
            config.maxTradeVolume,
            config.oracleTimeout
        )
    {
        require(config.targetName != bytes32(0), "targetName missing");
        if (config.defaultThreshold > 0) {
            require(config.delayUntilDefault > 0, "delayUntilDefault zero");
        }

        targetName = config.targetName;
        delayUntilDefault = config.delayUntilDefault;

        // Cache constants
        uint192 peg = targetPerRef(); // {target/ref}

        // {target/ref}= {target/ref} * {1}
        uint192 delta = peg.mul(config.defaultThreshold);
        pegBottom = peg - delta;
        pegTop = peg + delta;
    }

    /// Can revert, used by other contract functions in order to catch errors
    /// @dev Override this when pricing is more complicated than just a single oracle
    /// @param low {UoA/tok} The low price estimate
    /// @param high {UoA/tok} The high price estimate
    /// @param pegPrice {target/ref} The actual price observed in the peg
    function tryPrice()
        external
        view
        virtual
        override
        returns (uint192 low, uint192 high, uint192 pegPrice)
    {
        pegPrice = chainlinkFeed.price(oracleTimeout); // {target/ref}

        // {UoA/tok} = {target/ref} * {ref/tok} * {UoA/target} (1)
        uint192 p = pegPrice.mul(refPerTok());

        // oracleError is on whatever the _true_ price is, not the one observed
        low = p.div(FIX_ONE.plus(oracleError));
        high = p.div(FIX_ONE.minus(oracleError), CEIL);
    }

    /// Should not revert
    /// Refresh exchange rates and update default status.
    /// @dev Should be general enough to not need to be overridden
    function refresh() public virtual override {
        if (alreadyDefaulted()) return;
        CollateralStatus oldStatus = status();

        // Check for soft default + save fallbackPrice
        try this.tryPrice() returns (uint192 low, uint192, uint192 pegPrice) {
            // {UoA/tok}, {UoA/tok}, {target/ref}

            // If the price is below the default-threshold price, default eventually
            // uint192(+/-) is the same as Fix.plus/minus
            if (low == 0 || pegPrice < pegBottom || pegPrice > pegTop) {
                markStatus(CollateralStatus.IFFY);
            } else {
                fallbackPrice = low;
                markStatus(CollateralStatus.SOUND);
            }
        } catch (bytes memory errData) {
            // see: docs/solidity-style.md#Catching-Empty-Data
            if (errData.length == 0) revert(); // solhint-disable-line reason-string
            markStatus(CollateralStatus.IFFY);
        }

        // Check for hard default
        uint192 referencePrice = refPerTok();
        // uint192(<) is equivalent to Fix.lt
        if (referencePrice < prevReferencePrice) {
            markStatus(CollateralStatus.DISABLED);
        }
        prevReferencePrice = referencePrice;

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
        if (_whenDefault <= block.timestamp) return; // prevent DISABLED -> SOUND/IFFY

        if (status_ == CollateralStatus.SOUND) {
            _whenDefault = NEVER;
        } else if (status_ == CollateralStatus.IFFY) {
            _whenDefault = Math.min(block.timestamp + delayUntilDefault, _whenDefault);
        } else if (status_ == CollateralStatus.DISABLED) {
            _whenDefault = block.timestamp;
        }
    }

    function alreadyDefaulted() internal view returns (bool) {
        return _whenDefault <= block.timestamp;
    }

    function whenDefault() public view returns (uint256) {
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
