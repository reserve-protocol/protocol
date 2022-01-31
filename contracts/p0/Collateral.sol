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
            whenDefault = isReferenceDepegged()
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

    /// @return {UoA/tok} Our best guess at the market price of 1 whole token in UoA
    function price() public view virtual override(AssetP0, IAsset) returns (Fix) {
        // {UoA/tok} = {target/ref} * {ref/tok} * {UoA/target}
        return oracle.consult(referenceERC20).mul(refPerTok()).mul(pricePerTarget());
    }

    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    function refPerTok() public view virtual override returns (Fix) {
        return FIX_ONE;
    }

    /// @return {target/ref} Quantity of whole target units per whole reference unit in the peg
    function targetPerRef() public view virtual override returns (Fix) {
        return FIX_ONE;
    }

    /// @return {UoA/target} The price of a target unit in UoA
    function pricePerTarget() public view virtual override returns (Fix) {
        return FIX_ONE;
    }

    function isReferenceDepegged() internal view virtual returns (bool) {
        // {UoA/ref} = {UoA/target} * {target/ref}
        Fix peg = pricePerTarget().mul(targetPerRef());
        Fix delta = peg.mul(main.defaultThreshold());
        Fix p = oracle.consult(referenceERC20);
        return p.lt(peg.minus(delta)) || p.gt(peg.plus(delta));
    }
}
