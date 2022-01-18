// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "contracts/p0/interfaces/IOracle.sol";
import "contracts/libraries/Fixed.sol";
import "./IMain.sol";

/**
 * @title IAsset
 * @notice Supertype. Any token that interacts with our system must be wrapped in an asset,
 * whether it is used as RToken backing, or not. Any token that can report a usd price is eligible
 * to be an asset.
 */
interface IAsset {
    /// @return {attoUSD/qTok} The price of 1 qToken in attoUSD
    function price() external view returns (Fix);

    /// @dev Intended to be used via delegatecall, hence the `collateral` duplication
    function claimAndSweepRewards(ICollateral collateral, IMain main) external;

    /// @return The ERC20 contract of the token with decimals() available
    function erc20() external view returns (IERC20Metadata);

    /// @return The oracle the asset uses to price itself
    function oracle() external view returns (IOracle);

    /// @return If the asset is an instance of ICollateral or not
    function isCollateral() external view returns (bool);
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
    /// Force any updates such as updating the default status or poking the defi protocol.
    /// Block-idempotent.
    function forceUpdates() external;

    /// Disable the collateral so it cannot be used as backing
    function disable() external;

    /// @return {attoRef/qTok} The price of the asset in a (potentially non-USD) reference asset
    function referencePrice() external view returns (Fix);

    /// @return The status of this collateral asset. (Is it defaulting? Might it soon?)
    function status() external view returns (CollateralStatus);
}
