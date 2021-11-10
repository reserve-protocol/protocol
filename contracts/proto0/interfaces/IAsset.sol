// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
// import "contracts/proto0/interfaces/IAsset.sol";
import "contracts/proto0/interfaces/IMain.sol";
import "contracts/libraries/Fixed.sol";

/**
 * @title IAsset
 * @notice The top-level Asset interface. Any token that our system handles must be wrapped in an asset.
 */
interface IAsset {
    /// @return {attoUSD/qTok} The price in USD of the asset as a function of DeFi redemption rates + oracle data
    function priceUSD(IMain main) external returns (Fix);

    /// @return The ERC20 contract of the central token
    function erc20() external view returns (IERC20);

    /// @return The number of decimals in the central token
    function decimals() external view returns (uint8);
}

/**
 * @title ICollateral
 * @notice A subtype of Asset that consists of the tokens eligible to back the RToken.
 */
interface ICollateral is IAsset {
    /// Claims any rewards such as COMP/AAVE for the asset
    function claimRewards() external;

    /// @return {qFiatTok/qTok} Conversion rate between token and its fiatcoin. Incomparable across assets.
    function rateFiatcoin() external returns (Fix);

    /// @return {attoUSD/qTok} Without using oracles, returns the expected attoUSD value of one qTok.
    function rateUSD() external returns (Fix);

    /// @return The number of decimals in the nested fiatcoin contract (or for the erc20 itself if it is a fiatcoin)
    function fiatcoinDecimals() external view returns (uint8);

    /// @return The fiatcoin underlying the ERC20, or the erc20 itself if it is a fiatcoin
    function fiatcoin() external view returns (IERC20);

    /// @return {attoUSD/qTok} The price in USD of the fiatcoin underlying the ERC20 (or the price of the ERC20 itself)
    function fiatcoinPriceUSD(IMain main) external view returns (Fix);

    /// @return Whether the asset is (directly) a fiatcoin
    function isFiatcoin() external view returns (bool);
}
