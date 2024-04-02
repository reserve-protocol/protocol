// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "./IRToken.sol";

/**
 * @title IMaxIssuableFacet
 * @notice Facet for maxIssuable + maxIssuableByAmounts
 *
 * - @custom:static-call - Use ethers callStatic() in order to get result after update
v */
interface IMaxIssuableFacet {
    // === Static Calls ===

    /// @return How many RToken `account` can issue given current holdings
    /// @custom:static-call
    function maxIssuable(IRToken rToken, address account) external returns (uint256);

    /// @param amounts {qTok} The balances of each basket ERC20 to assume
    /// @return How many RToken can be issued
    /// @custom:static-call
    function maxIssuableByAmounts(IRToken rToken, uint256[] memory amounts)
        external
        returns (uint256);
}
