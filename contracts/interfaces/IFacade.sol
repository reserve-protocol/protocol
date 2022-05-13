// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/libraries/Fixed.sol";
import "./IRToken.sol";

/**
 * @title IFacade
 * @notice A UX-friendly layer for non-governance protocol interactions
 *
 * - @custom:static-call - Use ethers callStatic() in order to get result after update
 * - @custom:view - Regular view
 */
interface IFacade {
    /// Prompt all traders to run auctions
    /// @custom:action
    function runAuctionsForAllTraders() external;

    /// Prompt all traders and the RToken itself to claim rewards and sweep to BackingManager
    /// @custom:action
    function claimRewards() external;

    /// @return How many RToken `account` can issue given current holdings
    /// @custom:static-call
    function maxIssuable(address account) external returns (uint256);

    /// @return tokens Array of all known ERC20 asset addreses
    /// @return amounts {qTok} Array of balance that the protocol holds of this current asset
    /// @custom:static-call
    function currentAssets() external returns (address[] memory tokens, uint256[] memory amounts);

    /// @return total {UoA} An estimate of the total value of all assets held at BackingManager
    /// @custom:static-call
    function totalAssetValue() external returns (int192 total);

    /// @return deposits The deposits necessary to issue `amount` RToken
    /// @custom:static-call
    function issue(uint256 amount) external returns (uint256[] memory deposits);

    /// @return tokens The addresses of the ERC20s backing the RToken
    /// @custom:view
    function basketTokens() external view returns (address[] memory tokens);
}
