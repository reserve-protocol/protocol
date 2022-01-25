// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/Context.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "contracts/p0/interfaces/IAsset.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/interfaces/IOracle.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/p0/Asset.sol";

/**
 * @title CollateralP0
 * @notice A general pegged collateral type to be extended. Supports fiatcoins as-is.
 */
contract CollateralP0 is ICollateral, Context, AssetP0 {
    using FixLib for Fix;
    // Default Status:
    // whenDefault == NEVER: no risk of default (initial value)
    // whenDefault > block.timestamp: delayed default may occur as soon as block.timestamp.
    //                In this case, the asset may recover, reachiving whenDefault == NEVER.
    // whenDefault <= block.timestamp: default has already happened (permanently)
    uint256 internal constant NEVER = type(uint256).max;
    uint256 internal whenDefault = NEVER;

    // role: The basket-template role this Collateral plays. (See BasketHandler)
    bytes32 public immutable role;

    // govScore: Among Collateral with that rolw, the measure of governance's
    // preference that this Collateral plays that role. Higher is stronger.
    Fix private immutable govScore;

    // oldRefPrice: {qRef/qTok} The price of this derivative asset at some RToken-specific
    // previous time. Used when choosing new baskets.
    Fix private immutable oldRefPrice;

    /// @return {basket quantity/tok} At basket selection time, how many of the reference token does
    /// it take to satisfy this Collateral's role?
    // solhint-disable-next-line const-name-snakecase
    Fix public constant roleCoefficient = FIX_ONE;

    /// @return {USD/tok}
    Fix public constant PEG = FIX_ONE;

    constructor(
        IERC20Metadata erc20_,
        IMain main_,
        IOracle oracle_,
        bytes32 role_,
        Fix govScore_,
        Fix oldRefPrice_
    ) AssetP0(erc20_, main_, oracle_) {
        role = role_;
        govScore = govScore_;
        oldRefPrice = oldRefPrice_;
    }

    /// Default checks
    function forceUpdates() public virtual override {
        if (whenDefault > block.timestamp) {
            // If the price is below the default-threshold price, default eventually
            whenDefault = _isDepegged()
                ? Math.min(whenDefault, block.timestamp + main.defaultDelay())
                : NEVER;
        }
    }

    /// Disable the collateral directly
    function disable() external virtual override {
        require(_msgSender() == address(main) || _msgSender() == main.owner(), "main or its owner");
        if (whenDefault > block.timestamp) {
            whenDefault = block.timestamp;
        }
    }

    /// @return The asset's default status
    function status() external view virtual override returns (CollateralStatus) {
        if (whenDefault == NEVER) {
            return CollateralStatus.SOUND;
        } else if (whenDefault <= block.timestamp) {
            return CollateralStatus.DISABLED;
        } else {
            return CollateralStatus.IFFY;
        }
    }

    /// @return {qRef/qTok} The price of the asset in a (potentially non-USD) reference asset
    function referencePrice() public view virtual override returns (Fix) {
        return FIX_ONE;
    }

    /// @return If the asset is an instance of ICollateral or not
    function isCollateral() external pure virtual override(AssetP0, IAsset) returns (bool) {
        return true;
    }

    /// @return {none} The vault-selection score of this collateral
    /// @dev That is, govScore * (growth relative to the reference asset)
    function score() external view override returns (Fix) {
        // {none} = {none} * {qRef/qTok} / {qRef/qTok}
        return govScore.mul(referencePrice()).div(oldRefPrice);
    }

    function _isDepegged() internal view virtual returns (bool) {
        // {attoUSD/qTok} = {none} * {USD/tok} * {attoUSD/USD} / {qTok/tok}
        Fix delta = main.defaultThreshold().mul(PEG).shiftLeft(18 - int8(erc20.decimals()));
        Fix p = price();
        return p.lt(PEG.minus(delta)) || p.gt(PEG.plus(delta));
    }
}
