// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/libraries/Fixed.sol";
import "./IRToken.sol";

/**
 * @title IFacade
 * @notice A read-only layer on top of the protocol for use from an off-chain explorer.
 */
interface IFacade {
    function runAuctionsForAllTraders() external;

    function claimRewards() external;

    function doFurnaceMelting() external;

    function ensureBasket() external;

    /// @return How many RToken `account` can issue given current holdings
    function maxIssuable(address account) external view returns (uint256);

    function currentBacking()
        external
        view
        returns (address[] memory tokens, uint256[] memory quantities);

    function totalAssetValue() external view returns (Fix total);
}
