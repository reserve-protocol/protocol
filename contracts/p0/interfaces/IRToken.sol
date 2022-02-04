// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/draft-IERC20Permit.sol";
import "contracts/p0/interfaces/IMain.sol";

/**
 * @title IRToken
 * @notice An ERC20 with an elastic supply.
 * @dev The p0-specific IRToken
 */
interface IRToken is IERC20Metadata, IERC20Permit {
    /// Tracks data for a SlowIssuance
    /// @param blockStartedAt {blockNumber} The block number the issuance was started, non-fractional
    /// @param amount {qTok} The quantity of RToken the issuance is for
    /// @param baskets {BU} The basket unit-equivalent of the collateral deposits
    /// @param erc20s The collateral token addresses corresponding to the deposit
    /// @param deposits {qTok} The collateral token quantities that paid for the issuance
    /// @param issuer The account issuing RToken
    /// @param blockAvailableAt {blockNumber} The block number when the issuance completes, fractional
    /// @param processed false when the issuance is still vesting
    struct SlowIssuance {
        uint256 blockStartedAt;
        uint256 amount; // {qRTok}
        Fix baskets; // {BU}
        address[] erc20s;
        uint256[] deposits; // {qTok}, same index as vault basket assets
        address issuer;
        Fix blockAvailableAt; // {blockNumber} fractional
        bool processed;
    }

    /// Emitted when issuance is started, at the point collateral is taken in
    /// @param issuanceId The index off the issuance, a globally unique identifier
    /// @param issuer The account performing the issuance
    /// @param amount The quantity of RToken being issued
    /// @param baskets The basket unit-equivalent of the collateral deposits
    /// @param tokens The ERC20 contracts of the backing tokens
    /// @param quantities The quantities of tokens paid with
    /// @param blockAvailableAt The (continuous) block at which the issuance vests
    event IssuanceStarted(
        uint256 indexed issuanceId,
        address indexed issuer,
        uint256 indexed amount,
        Fix baskets,
        address[] tokens,
        uint256[] quantities,
        Fix blockAvailableAt
    );

    /// Emitted when an RToken issuance is canceled, such as during a default
    /// @param issuanceId The index of the issuance, a globally unique identifier
    event IssuanceCanceled(uint256 indexed issuanceId);

    /// Emitted when an RToken issuance is completed successfully
    /// @param issuanceId The index of the issuance, a globally unique identifier
    event IssuanceCompleted(uint256 indexed issuanceId);

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

    function poke() external;

    /// Begins the SlowIssuance process
    /// @param issuer The account issuing the RToken
    /// @param amount {qRTok}
    /// @param baskets {BU}
    /// @param deposits {qTok}
    function issue(
        address issuer,
        uint256 amount,
        Fix baskets,
        address[] memory erc20s,
        uint256[] memory deposits
    ) external;

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
