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
interface IFacadeRead {
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

    /// @return erc20s The ERC20 addresses in the current basket
    /// @return uoaShares The proportion of the basket associated with each ERC20
    /// @return targets The bytes32 representations of the target unit associated with each ERC20
    /// @custom:static-call
    function basketBreakdown(IRToken rToken)
        external
        returns (
            address[] memory erc20s,
            uint192[] memory uoaShares,
            bytes32[] memory targets
        );

    /// @return erc20s The registered ERC20s
    /// @return balances {qTok} The held balances of each ERC20 across all traders
    /// @return balancesNeededByBackingManager {qTok} does not account for backingBuffer
    /// @custom:static-call
    function balancesAcrossAllTraders(IRToken rToken)
        external
        returns (
            IERC20[] memory erc20s,
            uint256[] memory balances,
            uint256[] memory balancesNeededByBackingManager
        );

    // === Views ===

    struct Pending {
        uint256 index;
        uint256 availableAt;
        uint256 amount;
    }

    /// @param draftEra {draftEra} The draft era to query unstakings for
    /// @param account The account for the query
    /// @return {qRSR} All the pending StRSR unstakings for an account, in RSR
    function pendingUnstakings(
        RTokenP1 rToken,
        uint256 draftEra,
        address account
    ) external view returns (Pending[] memory);

    /// Returns the prime basket
    /// @dev Indices are shared across return values
    /// @return erc20s The erc20s in the prime basket
    /// @return targetNames The bytes32 name identifier of the target unit, per ERC20
    /// @return targetAmts {target/BU} The amount of the target unit in the basket, per ERC20
    function primeBasket(IRToken rToken)
        external
        view
        returns (
            IERC20[] memory erc20s,
            bytes32[] memory targetNames,
            uint192[] memory targetAmts
        );

    /// Returns the backup configuration for a given targetName
    /// @param targetName The name of the target unit to lookup the backup for
    /// @return erc20s The backup erc20s for the target unit, in order of most to least desirable
    /// @return max The maximum number of tokens from the array to use at a single time
    function backupConfig(IRToken rToken, bytes32 targetName)
        external
        view
        returns (IERC20[] memory erc20s, uint256 max);

    /// @return tokens The ERC20s backing the RToken
    function basketTokens(IRToken rToken) external view returns (address[] memory tokens);

    /// @return stTokenAddress The address of the corresponding stToken address
    function stToken(IRToken rToken) external view returns (IStRSR stTokenAddress);

    /// @return backing The worst-case collaterazation % the protocol will have after done trading
    /// @return overCollateralization The over-collateralization value relative to the
    ///     fully-backed value
    function backingOverview(IRToken rToken)
        external
        view
        returns (uint192 backing, uint192 overCollateralization);

    /// @return low {UoA/tok} The low price of the RToken as given by the relevant RTokenAsset
    /// @return high {UoA/tok} The high price of the RToken as given by the relevant RTokenAsset
    function price(IRToken rToken) external view returns (uint192 low, uint192 high);

    /// @return erc20s The list of ERC20s that have auctions that can be settled, for given trader
    function auctionsSettleable(ITrading trader) external view returns (IERC20[] memory erc20s);
}
