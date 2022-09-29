// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "contracts/interfaces/IMain.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/plugins/assets/RTokenAsset.sol";

/**
 * @title RTokenCollateral
 * @notice Plugin to use another RToken as collateral, without price feed
 *   - {tok} = RToken
 *   - {ref} = RToken (ideally we'd use the basket, but then refPerTok can fall)
 *   - {target} = RToken's basket
 * Warning: This plugin is pretty gas-inefficient and it should be replaced with one that uses
 *  a chainlink oracle ASAP. This is basically just for testing.
 */
contract RTokenCollateral is RTokenAsset, ICollateral {
    using FixLib for uint192;

    // Default Status:
    // whenDefault == NEVER: no risk of default (initial value)
    // whenDefault > block.timestamp: delayed default may occur as soon as block.timestamp.
    //                In this case, the asset may recover, reachiving whenDefault == NEVER.
    // whenDefault <= block.timestamp: default has already happened (permanently)
    uint256 internal constant NEVER = type(uint256).max;
    uint256 public whenDefault = NEVER;

    uint256 public immutable delayUntilDefault; // {s} e.g 86400

    bool public priceable;

    // targetName: The canonical name of this collateral's target unit.
    bytes32 public immutable targetName;

    /// @param maxTradeVolume_ {UoA} The max trade volume, in UoA
    constructor(
        IRToken erc20_,
        uint192 maxTradeVolume_,
        bytes32 targetName_,
        uint256 delayUntilDefault_
    ) RTokenAsset(erc20_, maxTradeVolume_) {
        require(targetName_ != bytes32(0), "targetName missing");
        targetName = targetName_;
        delayUntilDefault = delayUntilDefault_;
    }

    /// @return p {UoA/tok} The redemption price of the RToken
    function strictPrice() public view override(RTokenAsset, IAsset) returns (uint192) {
        return super.strictPrice();
    }

    /// Can return 0
    /// Cannot revert if `allowFallback` is true. Can revert if false.
    /// @param allowFallback Whether to try the fallback price in case precise price reverts
    /// @return isFallback If the price is a failover price
    /// @return {UoA/tok} The current price(), or if it's reverting, a fallback price
    function price(bool allowFallback)
        public
        view
        override(RTokenAsset, IAsset)
        returns (bool isFallback, uint192)
    {
        return super.price(allowFallback);
    }

    function refresh() external virtual override {
        if (whenDefault <= block.timestamp) return;
        CollateralStatus oldStatus = status();

        // No default checks -- we outsource stability to the collateral RToken
        try this.strictPrice() returns (uint192) {
            whenDefault = NEVER;
        } catch {
            whenDefault = Math.min(block.timestamp + delayUntilDefault, whenDefault);
        }

        CollateralStatus newStatus = status();
        if (oldStatus != newStatus) {
            emit DefaultStatusChanged(oldStatus, newStatus);
        }
    }

    /// @return The collateral's status
    function status() public view virtual override returns (CollateralStatus) {
        if (whenDefault == NEVER) {
            return CollateralStatus.SOUND;
        } else if (whenDefault > block.timestamp) {
            return CollateralStatus.IFFY;
        } else {
            return CollateralStatus.DISABLED;
        }
    }

    /// @return If the asset is an instance of ICollateral or not
    function isCollateral() external pure virtual override(RTokenAsset, IAsset) returns (bool) {
        return true;
    }

    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    function refPerTok() public view virtual returns (uint192) {
        // TODO make {ref} the basket unit
        return FIX_ONE;
    }

    /// @return {target/ref} Quantity of whole target units per whole reference unit in the peg
    function targetPerRef() public view virtual returns (uint192) {
        uint256 supply = erc20.totalSupply();
        if (supply == 0) return FIX_ONE;

        // downcast is safe; rToken supply fits in uint192
        // {target/ref} = {BU/rTok} = {BU} / {rTok}
        return IRToken(address(erc20)).basketsNeeded().div(uint192(supply));
    }

    /// @return {UoA/target} The price of a target unit in UoA
    function pricePerTarget() public view virtual returns (uint192) {
        (, uint192 basketPrice) = basketHandler.price(false);

        // price of a BU in the RToken
        return basketPrice;
    }
}
