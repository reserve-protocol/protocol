// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
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

    IBasketHandler public immutable basketHandler; // of the RToken being used as collateral

    bool public priceable;

    // targetName: The canonical name of this collateral's target unit.
    bytes32 public immutable targetName;

    /// @param maxTradeVolume_ {UoA} The max trade volume, in UoA
    constructor(
        IRToken erc20_,
        uint192 maxTradeVolume_,
        bytes32 targetName_
    ) RTokenAsset(erc20_, maxTradeVolume_) {
        require(targetName_ != bytes32(0), "targetName missing");
        targetName = targetName_;
        basketHandler = erc20_.main().basketHandler();
    }

    /// @return p {UoA/tok} The redemption price of the RToken
    function price() public view override(RTokenAsset, IAsset) returns (uint192) {
        return super.price();
    }

    /// @return {UoA/tok} The current price(), or if it's reverting, a fallback price
    function priceWithFailover() public view override(RTokenAsset, IAsset) returns (uint192) {
        return super.priceWithFailover();
    }

    function refresh() external virtual override {
        CollateralStatus oldStatus = status();

        // No default checks -- we outsource stability to the collateral RToken
        try this.price() returns (uint192 p) {
            priceable = p > 0;
        } catch {
            priceable = false;
        }

        CollateralStatus newStatus = status();
        if (oldStatus != newStatus) {
            emit DefaultStatusChanged(oldStatus, newStatus);
        }
    }

    /// @return The collateral's status -- either SOUND or UNPRICED
    function status() public view virtual returns (CollateralStatus) {
        return priceable ? CollateralStatus.SOUND : CollateralStatus.UNPRICED;
    }

    /// @return If the asset is an instance of ICollateral or not
    function isCollateral() external pure virtual override(RTokenAsset, IAsset) returns (bool) {
        return true;
    }

    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    function refPerTok() public view virtual returns (uint192) {
        // one RToken per RToken!
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
        // price of a BU in the RToken
        return basketHandler.price();
    }
}
