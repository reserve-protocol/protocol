// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/draft-IERC20Permit.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/libraries/Fixed.sol";

/**
 * @title IRToken
 * @notice An ERC20 with an elastic supply.
 * @dev The p0-specific IRToken
 */
interface IRToken is IERC20Metadata, IERC20Permit {
    /// Tracks data for a SlowIssuance
    /// @param issuer The account issuing RToken
    /// @param amount {qTok} The quantity of RToken the issuance is for
    /// @param baskets {BU} The basket unit-equivalent of the collateral deposits
    /// @param erc20s The ERC20 collateral tokens corresponding to the deposit
    /// @param deposits {qTok} The collateral token quantities that paid for the issuance
    /// @param basketNonce The basket nonce when the issuance was started
    /// @param blockAvailableAt {blockNumber} The block number when issuance completes, fractional
    /// @param processed false when the issuance is still vesting
    struct SlowIssuance {
        address issuer;
        uint256 amount; // {qRTok}
        Fix baskets; // {BU}
        IERC20Metadata[] erc20s;
        uint256[] deposits; // {qTok}, same index as vault basket assets
        uint256 basketNonce; // basket nonce
        Fix blockAvailableAt; // {block.number} fractional
        bool processed;
    }

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
        IERC20Metadata[] erc20s,
        uint256[] quantities,
        Fix blockAvailableAt
    );

    /// Emitted when an RToken issuance is canceled, such as during a default
    /// @param issuer The account of the issuer
    /// @param index The index of the issuance in the issuer's queue
    event IssuanceCanceled(address indexed issuer, uint256 indexed index);

    /// Emitted when an RToken issuance is completed successfully
    /// @param issuer The account of the issuer
    /// @param index The index of the issuance in the issuer's queue
    event IssuanceCompleted(address indexed issuer, uint256 indexed index);

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

    /// Begins the SlowIssuance process
    /// @param issuer The account issuing the RToken
    /// @param amount {qRTok}
    /// @param baskets {BU}
    /// @param deposits {qTok}
    function issue(
        address issuer,
        uint256 amount,
        Fix baskets,
        IERC20Metadata[] memory erc20s,
        uint256[] memory deposits
    ) external;

    /// Cancels a vesting slow issuance
    /// @param account The account of the issuer, and caller
    /// @param index The index of the issuance in the issuer's queue
    function cancelIssuance(address account, uint256 index) external;

    /// Completes all vested slow issuances for the account, callable by anyone
    /// @param account The address of the account to vest issuances for
    /// @return vested {qRTok} The total amount of RToken quanta vested
    function vestIssuances(address account) external returns (uint256 vested);

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
