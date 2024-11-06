// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "../../interfaces/IMain.sol";
import "../../libraries/Fixed.sol";
import "../assets/RTokenAsset.sol";

/**
 * @title RTokenCollateral
 * @notice Plugin to use another RToken as collateral, without price feed
 *   - {tok} = RToken
 *   - {ref} = RToken (ideally we'd use the basket, but then refPerTok can fall)
 *   - {target} = RToken's basket
 * Warning: This plugin is pretty gas-inefficient and it should be replaced with one that uses
 *  a chainlink oracle ASAP. This is basically just for testing.
 * Stronger yet: This should not be used in a production system, period.
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

    uint48 public immutable delayUntilDefault; // {s} e.g 86400

    bool public priceable;

    // targetName: The canonical name of this collateral's target unit.
    bytes32 public immutable targetName;

    uint192 public savedPegPrice; // {target/ref} The peg price of the token during the last update

    /// @param maxTradeVolume_ {UoA} The max trade volume, in UoA
    constructor(
        IRToken erc20_,
        uint192 maxTradeVolume_,
        bytes32 targetName_,
        uint48 delayUntilDefault_
    ) RTokenAsset(erc20_, maxTradeVolume_) {
        require(targetName_ != bytes32(0), "targetName missing");
        targetName = targetName_;
        delayUntilDefault = delayUntilDefault_;
    }

    /// Should not revert
    /// @return low {UoA/tok} The lower end of the price estimate
    /// @return high {UoA/tok} The upper end of the price estimate
    function price() public view override(RTokenAsset, IAsset) returns (uint192 low, uint192 high) {
        return super.price();
    }

    function refresh() public virtual override(RTokenAsset, IAsset) {
        if (whenDefault <= block.timestamp) return;
        CollateralStatus oldStatus = status();

        // No default checks -- we outsource stability to the collateral RToken
        whenDefault = NEVER;

        CollateralStatus newStatus = status();
        if (oldStatus != newStatus) {
            emit CollateralStatusChanged(oldStatus, newStatus);
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
        // {ref} should probably be this RToken's basket unit, and refPerTok() should
        // return its RToken-to-BU exchange rate. But this is just for testing...
        return FIX_ONE;
    }

    /// @return {target/ref} Quantity of whole target units per whole reference unit in the peg
    function targetPerRef() public view virtual returns (uint192) {
        uint256 supply = erc20.totalSupply();
        if (supply == 0) return FIX_ONE;

        // {target/ref} = {BU/rTok} = {BU} / {rTok}
        return IRToken(address(erc20)).basketsNeeded().div(_safeWrap(supply));
    }
}
