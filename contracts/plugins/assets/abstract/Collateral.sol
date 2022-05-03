// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/Context.sol";
import "contracts/interfaces/IAsset.sol";
import "contracts/interfaces/IMain.sol";
import "contracts/libraries/Fixed.sol";
import "./Asset.sol";

/**
 * @title Collateral
 * @notice A general non-appreciating collateral type to be extended.
 */
abstract contract Collateral is ICollateral, Asset, Context {
    using FixLib for int192;

    // Default Status:
    // whenDefault == NEVER: no risk of default (initial value)
    // whenDefault > block.timestamp: delayed default may occur as soon as block.timestamp.
    //                In this case, the asset may recover, reachiving whenDefault == NEVER.
    // whenDefault <= block.timestamp: default has already happened (permanently)
    uint256 internal constant NEVER = type(uint256).max;
    uint256 public whenDefault = NEVER;

    // targetName: The canonical name of this collateral's target unit.
    bytes32 public targetName;

    IERC20Metadata public referenceERC20;

    int192 public defaultThreshold; // {%} e.g. 0.05

    uint256 public delayUntilDefault; // {s} e.g 86400

    // solhint-disable-next-line func-name-mixedcase
    function __Collateral_init(
        IERC20Metadata erc20_,
        int192 maxTradeVolume_,
        int192 defaultThreshold_,
        uint256 delayUntilDefault_,
        IERC20Metadata referenceERC20_,
        bytes32 targetName_
    ) internal onlyInitializing {
        __Asset_init(erc20_, maxTradeVolume_);
        defaultThreshold = defaultThreshold_;
        delayUntilDefault = delayUntilDefault_;
        referenceERC20 = referenceERC20_;
        targetName = targetName_;
    }

    /// Default checks
    /// @dev This default check assumes that the collateral's price() value is expected
    /// to stay close to pricePerTarget() * targetPerRef(). If that's not true for the
    /// collateral you're defining, you MUST  this function!
    function forceUpdates() external virtual {
        if (whenDefault <= block.timestamp) {
            return;
        }
        uint256 cached = whenDefault;

        try this.price() returns (int192 p) {
            // {UoA/ref} = {UoA/target} * {target/ref}
            int192 peg = pricePerTarget().mul(targetPerRef());
            int192 delta = peg.mul(defaultThreshold);

            // If the price is below the default-threshold price, default eventually
            if (p.lt(peg.minus(delta)) || p.gt(peg.plus(delta))) {
                whenDefault = block.timestamp + delayUntilDefault;
            } else whenDefault = NEVER;
        } catch Panic(uint256) {
            // This indicates a problem in the price function!
            assert(false); // To confirm: there is no way to maintain the error code here
        } catch (bytes memory lowLevelData) {
            if (bytes4(lowLevelData) == bytes4(keccak256("PriceIsZero()"))) {
                // This means the oracle has broken on us and we should default immediately
                whenDefault = block.timestamp;
            } else revert UnknownError(lowLevelData);
        }

        if (whenDefault != cached) {
            emit DefaultStatusChanged(cached, whenDefault, status());
        }
    }

    /// @return The collateral's status
    function status() public view virtual returns (CollateralStatus) {
        if (whenDefault == NEVER) {
            return CollateralStatus.SOUND;
        } else if (whenDefault <= block.timestamp) {
            return CollateralStatus.DISABLED;
        } else {
            return CollateralStatus.IFFY;
        }
    }

    /// @return If the asset is an instance of ICollateral or not
    function isCollateral() external pure virtual override(Asset, IAsset) returns (bool) {
        return true;
    }

    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    function refPerTok() public view virtual returns (int192) {
        return FIX_ONE;
    }

    /// @return {target/ref} Quantity of whole target units per whole reference unit in the peg
    function targetPerRef() public view virtual returns (int192) {
        return FIX_ONE;
    }

    /// @return {UoA/target} The price of a target unit in UoA
    function pricePerTarget() public view virtual returns (int192) {
        return FIX_ONE;
    }
}
