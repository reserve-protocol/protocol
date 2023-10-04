// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "../p1/RToken.sol";
import "./IRToken.sol";
import "./IStRSR.sol";

/**
 * @title IFacadeRead
 * @notice A UX-friendly layer for read operations, especially those that first require refresh()
 *
 * - @custom:static-call - Use ethers callStatic() in order to get result after update
v */
interface IFacadeMint {
    // === Static Calls ===

    /// @return How many RToken `account` can issue given current holdings
    /// @custom:static-call
    function maxIssuable(IRToken rToken, address account) external returns (uint256);

    /// @return tokens The erc20 needed for the issuance
    /// @return deposits {qTok} The deposits necessary to issue `amount` RToken
    /// @return depositsUoA {UoA} The UoA value of the deposits necessary to issue `amount` RToken
    /// @custom:static-call
    function issue(IRToken rToken, uint256 amount)
        external
        returns (
            address[] memory tokens,
            uint256[] memory deposits,
            uint192[] memory depositsUoA
        );

    /// @return tokens The erc20s returned for the redemption
    /// @return withdrawals The balances the reedemer would receive after a full redemption
    /// @return available The amount actually available, for each token
    /// @dev If available[i] < withdrawals[i], then RToken.redeem() would revert
    /// @custom:static-call
    function redeem(IRToken rToken, uint256 amount)
        external
        returns (
            address[] memory tokens,
            uint256[] memory withdrawals,
            uint256[] memory available
        );

    /// @return tokens The erc20s returned for the redemption
    /// @return withdrawals The balances the reedemer would receive after redemption
    /// @custom:static-call
    function redeemCustom(
        IRToken rToken,
        uint256 amount,
        uint48[] memory basketNonces,
        uint192[] memory portions
    ) external returns (address[] memory tokens, uint256[] memory withdrawals);

    /// Return the `portions` for a `RToken.redeemCustom()` call that maximizes redemption value
    /// Use `FacadeRead.redeemCustom()` to calculate the expected min amounts out after
    /// Will skip any basket nonces for which any collateral have been unregistered
    /// @param portions {1} The fraction of the custom redemption to pull from each basket nonce
    /// @custom:static-call
    function customRedemptionPortions(RTokenP1 rToken) external returns (uint192[] memory portions);
}
