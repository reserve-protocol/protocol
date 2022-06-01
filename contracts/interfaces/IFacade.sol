// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "./IRToken.sol";
import "./IStRSR.sol";

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
    function runAuctionsForAllTraders(IRToken rToken) external;

    /// Prompt all traders and the RToken itself to claim rewards and sweep to BackingManager
    /// @custom:interaction
    function claimRewards(IRToken rToken) external;

    /// @return How many RToken `account` can issue given current holdings
    /// @custom:static-call
    function maxIssuable(IRToken rToken, address account) external returns (uint256);

    /// @return tokens Array of all known ERC20 asset addreses
    /// @return amounts {qTok} Array of balance that the protocol holds of this current asset
    /// @custom:static-call
    function currentAssets(IRToken rToken)
        external
        returns (address[] memory tokens, uint256[] memory amounts);

    /// @return total {UoA} An estimate of the total value of all assets held at BackingManager
    /// @custom:static-call
    function totalAssetValue(IRToken rToken) external returns (uint192 total);

    /// @return deposits The deposits necessary to issue `amount` RToken
    /// @custom:static-call
    function issue(IRToken rToken, uint256 amount) external returns (uint256[] memory deposits);

    /// @return tokens The addresses of the ERC20s backing the RToken
    /// @custom:view
    function basketTokens(IRToken rToken) external view returns (address[] memory tokens);

    /// @return stTokenAddress The address of the corresponding stToken address
    /// @custom:view
    function stToken(IRToken rToken) external view returns (IStRSR stTokenAddress);
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
    function pendingIssuances(IRToken rToken, address account)
        external
        view
        returns (Pending[] memory);

    /// @param account The account for the query
    /// @return All the pending StRSR unstakings for an account
    /// @custom:view
    function pendingUnstakings(IRToken rToken, address account)
        external
        view
        returns (Pending[] memory);
}
