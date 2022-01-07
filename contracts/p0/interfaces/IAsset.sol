// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "contracts/libraries/Fixed.sol";

/// Unit of Account
enum UoA {
    USD,
    EUR
}

struct Price {
    Fix attoUSD;
    Fix attoEUR;
}

/**
 * @title IAsset
 * @notice Supertype. Any token that interacts with our system must be wrapped in an asset,
 * whether it is used as RToken backing, or not.
 */
interface IAsset {
    /// Unit of Account
    /// @return The primary Unit of Account for the asset
    function uoa() external view returns (UoA);

    /// @return {Price/tok} The price of 1 whole token
    function price() external view returns (Price memory);

    /// @return The ERC20 contract of the token with decimals() available
    function erc20() external view returns (IERC20Metadata);
}

enum CollateralStatus {
    SOUND,
    IFFY,
    DEFAULTED
}

/**
 * @title ICollateral
 * @notice A subtype of Asset that consists of the tokens eligible to back the RToken.
 * There are two types of collateral, derivative and non-derivative.
 *   - Derivative collateral has underlying collateral (like a non-leaf node in a linked list)
 *   - Non-derivative collateral is itself a direct representation of a UoA (Unit of Account)
 * Note: This structure can be used to capture N-levels-nested asset structures.
 */
interface ICollateral is IAsset {
    /// Forces any updates, such as updating the default status. Block-idempotent.
    function forceUpdates() external;

    /// @return The status of this collateral asset. (Is it defaulting? Might it soon?)
    function defaultStatus() external view returns (CollateralStatus);

    /// @return The address of the underlying collateral asset, or the 0 address if there isn't one
    function underlying() external view returns (ICollateral);
}
