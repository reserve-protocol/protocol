// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "./IMain.sol";
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
    /// @custom:interaction
    function runAuctionsForAllTraders(IMain main) external;

    /// Prompt all traders and the RToken itself to claim rewards and sweep to BackingManager
    /// @custom:interaction
    function claimRewards(IMain main) external;

    /// @return How many RToken `account` can issue given current holdings
    /// @custom:static-call
    function maxIssuable(IMain main, address account) external returns (uint256);

    /// @return tokens Array of all known ERC20 asset addreses
    /// @return amounts {qTok} Array of balance that the protocol holds of this current asset
    /// @custom:static-call
    function currentAssets(IMain main)
        external
        returns (address[] memory tokens, uint256[] memory amounts);

    /// @return total {UoA} An estimate of the total value of all assets held at BackingManager
    /// @custom:static-call
    function totalAssetValue(IMain main) external returns (uint192 total);

    /// @return deposits The deposits necessary to issue `amount` RToken
    /// @custom:static-call
    function issue(IMain main, uint256 amount) external returns (uint256[] memory deposits);

    /// @return tokens The addresses of the ERC20s backing the RToken
    /// @custom:view
    function basketTokens(IMain main) external view returns (address[] memory tokens);
}

interface IFacadeP1 is IFacade {
    struct Pending {
        uint256 index;
        uint256 availableAt;
        uint256 amount;
    }

    // ===

    /// @param account The account for the query
    /// @return All the pending RToken issuances for an account
    /// @custom:view
    function pendingIssuances(IMain main, address account) external view returns (Pending[] memory);

    /// @param account The account for the query
    /// @return All the pending StRSR unstakings for an account
    /// @custom:view
    function pendingUnstakings(IMain main, address account)
        external
        view
        returns (Pending[] memory);
}
