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
 * @notice An ERC20 with an elastic supply.
 * @dev The p0-specific IRToken
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
        Fix baskets,
        address[] erc20s,
        uint256[] quantities,
        Fix blockAvailableAt
    );

    /// Emitted when an RToken issuance is canceled, such as during a default
    /// @param issuer The account of the issuer
    /// @param firstIndex The first of the cancelled issuances in the issuer's queue
    /// @param lastIndex The last of the cancelled issuances in the issuer's queue
    event IssuancesCanceled(
        address indexed issuer,
        uint256 indexed firstIndex,
        uint256 indexed endIndex
    );

    /// Emitted when an RToken issuance is completed successfully
    /// @param issuer The account of the issuer
    /// @param firstIndex The first of the completed issuances in the issuer's queue
    /// @param lastIndex The first of the completed issuances in the issuer's queue
    event IssuancesCompleted(
        address indexed issuer,
        uint256 indexed firstIndex,
        uint256 indexed endIndex
    );

    /// Emitted when the number of baskets needed changes
    /// @param oldBasketsNeeded Previous number of baskets units needed
    /// @param newBasketsNeeded New number of basket units needed
    event BasketsNeededChanged(Fix oldBasketsNeeded, Fix newBasketsNeeded);

    /// Emitted when RToken is melted, which causes the basketRate to increase
    /// @param amount {qRTok}
    event Melted(uint256 amount);

    /// Emitted when Main is set
    /// @param oldMain The old address of Main
    /// @param newMain The new address of Main
    event MainSet(IMain indexed oldMain, IMain indexed newMain);

    event IssuanceRateSet(Fix indexed oldVal, Fix indexed newVal);

    /// Begins the SlowIssuance process
    /// User Action
    /// @param account The account issuing the RToken
    /// @param amtRToken {qRTok}
    /// @param amtBaskets {BU}
    /// @param erc20s {address[]}
    /// @param deposits {qTok[]}
    function issue(
        address account,
        uint256 amtRToken,
        Fix amtBaskets,
        address[] memory erc20s,
        uint256[] memory deposits
    ) external;

    /// Cancels a vesting slow issuance of _msgSender
    /// User Action
    /// If earliest == true, cancel id if id < endId
    /// If earliest == false, cancel id if endId <= id
    /// @param endId One edge of the issuance range to cancel
    /// @param earliest If true, cancel earliest issuances; else, cancel latest issuances
    function cancelIssuances(uint256 endId, bool earliest)
        external
        returns (uint256[] memory deposits);

    /// Completes vested slow issuances for the account, up to endId.
    /// User Action, callable by anyone
    /// @param account The address of the account to vest issuances for
    /// @return vested {qRTok} The total amount of RToken quanta vested
    function vestIssuances(address account, uint256 endId) external returns (uint256 vested);

    /// Return the highest index that could be completed by a vestIssuances call.
    function endIdForVest(address account) external view returns (uint256);

    /// Burns a quantity of RToken from the callers account
    /// @param from The account from which RToken should be burned
    /// @param amount {qRTok} The amount to be burned
    /// @param baskets {BU}
    function redeem(
        address from,
        uint256 amount,
        Fix baskets
    ) external;

    /// Mints a quantity of RToken to the `recipient`
    /// @param recipient The recipient of the newly minted RToken
    /// @param amount {qRTok} The amount to be minted
    function mint(address recipient, uint256 amount) external;

    /// Melt a quantity of RToken from the caller's account, increasing the basketRate
    /// @param amount {qTok} The amount to be melted
    function melt(uint256 amount) external;

    function setMain(IMain main) external;

    /// An affordance of last resort for Main in order to ensure re-capitalization
    function setBasketsNeeded(Fix basketsNeeded) external;

    /// @return {BU} How many baskets are being targeted by the RToken supply
    function basketsNeeded() external view returns (Fix);
}
