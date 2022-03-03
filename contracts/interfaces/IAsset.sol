// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "contracts/libraries/Fixed.sol";
import "./IMain.sol";
import "./IClaimAdapter.sol";

/**
 * @title IAsset
 * @notice Supertype. Any token that interacts with our system must be wrapped in an asset,
 * whether it is used as RToken backing, or not. Any token that can report a price in the UoA
 * is eligible to be an asset.
 */
interface IAsset {
    /// @return {UoA/tok} Our best guess at the market price of 1 whole token in UoA
    function price() external view returns (Fix);

    /// {tok} -> {qTok}
    function toQ(Fix tok) external view returns (Fix);

    /// {qTok} -> {tok}
    function fromQ(Fix qTok) external view returns (Fix);

    /// @return The ERC20 contract of the token with decimals() available
    function erc20() external view returns (IERC20Metadata);

    /// @return If the asset is an instance of ICollateral or not
    function isCollateral() external view returns (bool);

    /// @return {UoA}
    function maxAuctionSize() external view returns (Fix);
}

enum CollateralStatus {
    SOUND,
    IFFY,
    DISABLED
}

/**
 * @title ICollateral
 * @notice A subtype of Asset that consists of the tokens eligible to back the RToken.
 */
interface ICollateral is IAsset {
    /// Emitted whenever `whenDefault` is changed
    /// @param oldWhenDefault The old value of `whenDefault`
    /// @param newWhenDefault The new value of `whenDefault`
    /// @param status The updated CollateralStatus
    event DefaultStatusChanged(
        uint256 indexed oldWhenDefault,
        uint256 indexed newWhenDefault,
        CollateralStatus indexed status
    );

    /// Force any updates such as updating the default status or poking the defi protocol.
    /// Block-idempotent.
    function forceUpdates() external;

    /// @return The claim adapter that should be used with this asset, or the zero address
    function claimAdapter() external view returns (IClaimAdapter);

    /// @return The canonical name of this collateral's target unit.
    function targetName() external view returns (bytes32);

    /// @return The status of this collateral asset. (Is it defaulting? Might it soon?)
    function status() external view returns (CollateralStatus);

    // ==== Exchange Rates ====

    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    function refPerTok() external view returns (Fix);

    /// @return {target/ref} Quantity of whole target units per whole reference unit in the peg
    function targetPerRef() external view returns (Fix);

    /// @return {UoA/target} The price of the target unit in UoA (usually this is {UoA/UoA} = 1)
    function pricePerTarget() external view returns (Fix);
}
