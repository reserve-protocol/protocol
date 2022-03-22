// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/draft-IERC20Permit.sol";
import "contracts/libraries/Fixed.sol";
import "./IComponent.sol";
import "./IMain.sol";
import "./IRewardable.sol";

/**
 * @title IRToken
 * @notice An RToken is an ERC20 that is permissionlessly issuable/redeemable and tracks an
 *   exchange rate against a single unit: baskets, or {BU} in our type notation.
 */
interface IRToken is IRewardable, IERC20Metadata, IERC20Permit {
    /// Emitted when issuance is started, at the point collateral is taken in
    /// @param issuer The account performing the issuance
    /// @param index The index off the issuance in the issuer's queue
    /// @param amount The quantity of RToken being issued
    /// @param baskets The basket unit-equivalent of the collateral deposits
    /// @param erc20s The ERC20 collateral tokens corresponding to the quantities
    /// @param quantities The quantities of tokens paid with
    /// @param blockAvailableAt The (continuous) block at which the issuance vests
    event IssuanceStarted(
        address indexed issuer,
        uint256 indexed index,
        uint256 indexed amount,
        int192 baskets,
        address[] erc20s,
        uint256[] quantities,
        int192 blockAvailableAt
    );

    /// Emitted when an RToken issuance is canceled, such as during a default
    /// @param issuer The account of the issuer
    /// @param firstId The first of the cancelled issuances in the issuer's queue
    /// @param endId The last of the cancelled issuances in the issuer's queue
    event IssuancesCanceled(address indexed issuer, uint256 indexed firstId, uint256 indexed endId);

    /// Emitted when an RToken issuance is completed successfully
    /// @param issuer The account of the issuer
    /// @param firstId The first of the completed issuances in the issuer's queue
    /// @param endId The first of the completed issuances in the issuer's queue
    event IssuancesCompleted(
        address indexed issuer,
        uint256 indexed firstId,
        uint256 indexed endId
    );

    /// Emitted when a redemption of RToken occurs
    /// @param redeemer The address of the account redeeeming RTokens
    /// @param amount The quantity of RToken being redeemed
    /// @param baskets The corresponding number of baskets
    event Redemption(address indexed redeemer, uint256 indexed amount, int192 indexed baskets);

    /// Emitted when the number of baskets needed changes
    /// @param oldBasketsNeeded Previous number of baskets units needed
    /// @param newBasketsNeeded New number of basket units needed
    event BasketsNeededChanged(int192 oldBasketsNeeded, int192 newBasketsNeeded);

    /// Emitted when RToken is melted, i.e the RToken supply is decreased but basketsNeeded is not
    /// @param amount {qRTok}
    event Melted(uint256 amount);

    /// Emitted when the IssuanceRate is set
    event IssuanceRateSet(int192 indexed oldVal, int192 indexed newVal);

    /// Begin a time-delayed issuance of RToken for basket collateral
    /// @param amount {qRTok} The quantity of RToken to issue
    /// @return deposits {qRTok} The quantities of collateral tokens transferred in
    /// @custom:action
    function issue(uint256 amount) external returns (uint256[] memory deposits);

    /// Cancels a vesting slow issuance of _msgSender
    /// If earliest == true, cancel id if id < endId
    /// If earliest == false, cancel id if endId <= id
    /// @param endId One edge of the issuance range to cancel
    /// @param earliest If true, cancel earliest issuances; else, cancel latest issuances
    /// @custom:action
    function cancel(uint256 endId, bool earliest) external returns (uint256[] memory deposits);

    /// Completes vested slow issuances for the account, up to endId.
    /// @param account The address of the account to vest issuances for
    /// @return vested {qRTok} The total amount of RToken quanta vested
    /// @custom:completion
    function vest(address account, uint256 endId) external returns (uint256 vested);

    /// Return the highest index that could be completed by a vestIssuances call.
    /// @dev Use with `vest`
    function endIdForVest(address account) external view returns (uint256);

    /// Redeem RToken for basket collateral
    /// @param amount {qRTok} The quantity {qRToken} of RToken to redeem
    /// @return compensation {qRTok} The quantities of collateral tokens transferred out
    /// @custom:action
    function redeem(uint256 amount) external returns (uint256[] memory compensation);

    /// Mints a quantity of RToken to the `recipient`, callable only by the BackingManager
    /// @param recipient The recipient of the newly minted RToken
    /// @param amount {qRTok} The amount to be minted
    function mint(address recipient, uint256 amount) external;

    /// Melt a quantity of RToken from the caller's account
    /// @param amount {qRTok} The amount to be melted
    function melt(uint256 amount) external;

    /// Set the number of baskets needed directly, callable only by the BackingManager
    /// @param basketsNeeded {BU} The number of baskets to target
    ///                      needed range: pretty interesting
    function setBasketsNeeded(int192 basketsNeeded) external;

    /// @return {BU} How many baskets are being targeted
    function basketsNeeded() external view returns (int192);

    /// @return p {UoA/rTok} The price of 1 whole RToken in the unit of account
    function price() external view returns (int192 p);
}
