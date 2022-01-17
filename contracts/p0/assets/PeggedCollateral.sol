// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "contracts/p0/assets/Asset.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/interfaces/IOracle.sol";
import "contracts/libraries/Fixed.sol";
import "./Collateral.sol";

/**
 * @title PeggedCollateralP0
 * @notice A general pegged asset such as a USD fiatcoin or PAXG or WBTC.
 */
contract PeggedCollateralP0 is CollateralP0 {
    using FixLib for Fix;

    // Default Status:
    // whenDefault == NEVER: no risk of default (initial value)
    // whenDefault > block.timestamp: delayed default may occur as soon as block.timestamp.
    //                In this case, the asset may recover, reachiving whenDefault == NEVER.
    // whenDefault <= block.timestamp: default has already happened (permanently)
    uint256 internal constant NEVER = type(uint256).max;
    uint256 internal whenDefault = NEVER;
    uint256 internal prevBlock; // Last block when _updateDefaultStatus() was called

    /// The rate between the asset and what it is pegged to. Usually 1
    Fix private immutable _scalar;

    constructor(
        IERC20Metadata erc20_,
        IMain main_,
        IOracle oracle_,
        UoA uoa_,
        Fix scalar
    ) CollateralP0(erc20_, main_, oracle_, uoa_) {
        _scalar = scalar;
    }

    /// Sets `whenDefault`, `prevBlock`, and `prevRate` idempotently
    function forceUpdates() public virtual override {
        if (whenDefault > block.timestamp) {
            // If the price is below the default-threshold price, default eventually
            whenDefault = priceUoA().lte(minPrice())
                ? Math.min(whenDefault, block.timestamp + main.defaultDelay())
                : NEVER;
        }

        prevBlock = block.number;
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

    /// @return {attoUoA/tok} Minimum price of a pegged asset to be considered non-defaulting
    function minPrice() public view virtual returns (Fix) {
        // {attoUoA/tok} = {attoUoA/tok} * {none}
        return main.defaultThreshold().mul(_scalar);
    }
}
