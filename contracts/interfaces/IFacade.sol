// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/libraries/Fixed.sol";
import "./IRToken.sol";

/**
 * @title IFacade
 * @notice A UX-friendly layer for non-governance protocol interactions
 *
 * @dev
 * - @custom:bundle-action - Bundle multiple transactions to make sure they run on the same block
 * - @custom:static-call - Use ethers callStatic() in order to get result after update
 * - @custom:view - Just expose a abstraction layer for getting protocol view data
 */
interface IFacade {
    /// Prompt all traders to run auctions
    /// @custom:bundle-action
    function runAuctionsForAllTraders() external;

    /// Prompt all traders and the RToken itself to claim rewards and sweep to BackingManager
    /// @custom:bundle-action
    function claimRewards() external;

    /// @return How many RToken `account` can issue given current holdings
    /// @custom:static-call
    function maxIssuable(address account) external returns (uint256);

    /// @return tokens Array of all known ERC20 asset addreses.
    /// @return amounts {qTok} Array of balance that the protocol holds of this current asset
    /// @custom:static-call
    function currentAssets() external returns (address[] memory tokens, uint256[] memory amounts);

    /// @return The exchange rate between StRSR and RSR as a Fix
    /// @custom:static-call
    function stRSRExchangeRate() external returns (Fix);

    /// @return total {UoA} An estimate of the total value of all assets held at BackingManager
    /// @custom:static-call
    function totalAssetValue() external returns (Fix total);

    /// @return tokens The addresses of the ERC20s backing the RToken
    /// @custom:view
    function basketTokens() external view returns (address[] memory tokens);
}
