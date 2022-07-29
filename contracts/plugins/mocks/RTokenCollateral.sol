// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "contracts/interfaces/IMain.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/plugins/assets/AbstractCollateral.sol";

/**
 * @title RTokenCollateral
 * @notice Plugin to use another RToken as collateral, without price feed
 *   - {tok} = RToken
 *   - {ref} = RToken (ideally we'd use the basket, but then refPerTok can fall)
 *   - {target} = RToken's basket
 * Warning: This plugin is pretty gas-inefficient and it should be replaced with one that uses
 *  a chainlink oracle ASAP.
 */
contract RTokenCollateral is ICollateral, Asset {
    using FixLib for uint192;

    IRToken public immutable rToken; // the RToken being used as collateral
    IBasketHandler public immutable basketHandler; // of the RToken being used as collateral

    bool public priceable;

    // targetName: The canonical name of this collateral's target unit.
    bytes32 public immutable targetName;

    /// @param tradingRange_ {tok} The min and max of the trading range for this asset
    constructor(
        IMain main_,
        TradingRange memory tradingRange_,
        bytes32 targetName_
    )
        Asset(
            AggregatorV3Interface(address(1)),
            IERC20Metadata(address(main_.rToken())),
            IERC20Metadata(address(0)),
            tradingRange_,
            1
        )
    {
        require(targetName_ != bytes32(0), "targetName missing");
        require(main_ != IMain(address(0)), "main missing");
        targetName = targetName_;
        rToken = main_.rToken();
        basketHandler = main_.basketHandler();
    }

    /// @return {UoA/rTok}
    function price() public view virtual override(IAsset, Asset) returns (uint192) {
        return rToken.price();
    }

    function refresh() external virtual override {
        CollateralStatus oldStatus = status();

        // No default checks -- we outsource stability to the collateral RToken
        try rToken.price() returns (uint192) {
            priceable = true;
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
    function isCollateral() external pure virtual override(Asset, IAsset) returns (bool) {
        return true;
    }

    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    function refPerTok() public view virtual returns (uint192) {
        // one RToken per RToken!
        return FIX_ONE;
    }

    /// @return {target/ref} Quantity of whole target units per whole reference unit in the peg
    function targetPerRef() public view virtual returns (uint192) {
        uint256 supply = rToken.totalSupply();
        if (supply == 0) return FIX_ONE;

        // downcast is safe; rToken supply fits in uint192
        // {target/ref} = {BU/rTok} = {BU} / {rTok}
        return rToken.basketsNeeded().div(uint192(supply));
    }

    /// @return {UoA/target} The price of a target unit in UoA
    function pricePerTarget() public view virtual returns (uint192) {
        // price of a BU in the RToken
        return basketHandler.price();
    }
}
