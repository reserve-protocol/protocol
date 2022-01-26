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
 * @notice A general non-appreciating collateral type to be extended.
 */
contract CollateralP0 is ICollateral, Context, AssetP0 {
    using FixLib for Fix;
    // Default Status:
    // whenDefault == NEVER: no risk of default (initial value)
    // whenDefault > block.timestamp: delayed default may occur as soon as block.timestamp.
    //                In this case, the asset may recover, reachiving whenDefault == NEVER.
    // whenDefault <= block.timestamp: default has already happened (permanently)
    uint256 internal constant NEVER = type(uint256).max;
    uint256 public whenDefault = NEVER;

    // targetName: The canonical name of this collateral's target unit.
    bytes32 public immutable targetName;

    /// @return {ref/target} How many of the reference token makes up 1 target unit?
    // solhint-disable-next-line const-name-snakecase
    Fix public constant targetRate = FIX_ONE;

    IERC20Metadata public immutable referenceERC20;

    constructor(
        IERC20Metadata erc20_,
        IERC20Metadata referenceERC20_,
        IMain main_,
        IOracle oracle_,
        bytes32 targetName_
    ) AssetP0(erc20_, main_, oracle_) {
        referenceERC20 = referenceERC20_;
        targetName = targetName_;
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

    /// @return If the asset is an instance of ICollateral or not
    function isCollateral() external pure virtual override(AssetP0, IAsset) returns (bool) {
        return true;
    }

    /// @return {ref/tok} The price of 1 whole token in terms of whole reference units
    function referencePrice() public view virtual override returns (Fix) {
        return FIX_ONE;
    }

    function _isDepegged() private view returns (bool) {
        // {USD/ref} = {none} * {USD/ref}
        Fix delta = main.defaultThreshold().mul(targetRate);

        // {USD/ref} = {attoUSD/ref} / {attoUSD/USD}
        Fix p = oracle.consult(erc20).shiftLeft(-18);

        return p.lt(targetRate.minus(delta)) || p.gt(targetRate.plus(delta));
    }
}
