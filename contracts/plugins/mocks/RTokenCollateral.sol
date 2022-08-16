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
 *  a chainlink oracle ASAP. This is basically just for testing.
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

    /// @return p {UoA/rTok} The protocol's best guess of the redemption price of an RToken
    function price() public view override(Asset, IAsset) returns (uint192 p) {
        IMain main = rToken.main();
        uint256 totalSupply = rToken.totalSupply();
        uint256 basketsNeeded = rToken.basketsNeeded();
        require(totalSupply > 0, "no supply");

        // downcast is safe: basketsNeeded is <= 1e39
        // D18{BU} = D18{BU} * D18{rTok} / D18{rTok}
        uint192 amtBUs = uint192((basketsNeeded * FIX_ONE_256) / totalSupply);
        (address[] memory erc20s, uint256[] memory quantities) = basketHandler.quote(amtBUs, FLOOR);

        uint256 erc20length = erc20s.length;
        address backingMgr = address(main.backingManager());
        IAssetRegistry assetRegistry = main.assetRegistry();

        // Bound each withdrawal by the prorata share, in case we're currently under-capitalized
        for (uint256 i = 0; i < erc20length; ++i) {
            IAsset asset = assetRegistry.toAsset(IERC20(erc20s[i]));

            // {qTok} =  {qRTok} * {qTok} / {qRTok}
            uint256 prorated = (FIX_ONE_256 * IERC20(erc20s[i]).balanceOf(backingMgr)) /
                (totalSupply);

            if (prorated < quantities[i]) quantities[i] = prorated;

            // D18{tok} = D18 * {qTok} / {qTok/tok}
            uint192 q = shiftl_toFix(quantities[i], -int8(IERC20Metadata(erc20s[i]).decimals()));

            // downcast is safe: total attoUoA from any single asset is well under 1e47
            // D18{UoA} = D18{UoA} + (D18{UoA/tok} * D18{tok} / D18
            p += uint192((asset.price() * uint256(q)) / FIX_ONE);
        }
    }

    function refresh() external virtual override {
        CollateralStatus oldStatus = status();

        // No default checks -- we outsource stability to the collateral RToken
        try this.price() returns (uint192) {
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
