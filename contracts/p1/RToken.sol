// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/draft-ERC20Permit.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/interfaces/IRToken.sol";
import "contracts/libraries/Fixed.sol";

/**
 * @title RTokenP0
 * @notice An ERC20 with an elastic supply and governable exchange rate to basket units.
 */
contract RTokenP0 is Ownable, ERC20Permit, IRToken {
    using EnumerableSet for EnumerableSet.AddressSet;
    using FixLib for Fix;
    using SafeERC20 for IERC20Metadata;
    using SafeERC20 for IERC20;

    Fix public constant MIN_ISS_RATE = Fix.wrap(1e40); // {qRTok/block} 10k whole RTok

    IMain public main;

    // Enforce a fixed issuanceRate throughout the entire block by caching it.
    Fix lastIssRate; // {qRTok/block}
    uint256 lastIssRateBlock; // {block number}

    // When the all pending issuances will have vested.
    // This is fractional so that we can represent partial progress through a block.
    Fix allVestAt; // {fractional block number}

    /** Issuance ticket.
     * @param amtRToken {qTok} The amount of RToken that paid for this issuance
     * @param baskets {BU} The number of future baskets to issue
     * @param deposits {qTok} The collateral token quantities that paid for the issuance
     * @param blockAvailableAt {blockNumber} The block number when issuance completes, fractional
     */
    struct TotalIssues {
        uint256 when; // {block number}
        uint256 amtRToken; // {qRTok} Total amount of RTokens that have vested by `when`
        Fix amtBaskets; // {BU} Total amount of baskets that should back those RTokens
        uint256[] deposits; // {qTok}, Total amounts of basket collateral deposited for vesting
    }

    struct IssueQueue {
        // TODO: One of whenInitialized and tokens is probably not necessary. Work this out later.
        // TODO: Wrong behavior on whenInitialized if a switchBasket is in the same block?
        // Pretty sure we'll use tokens here, and never wehnInitialized.
        uint256 whenInitialized; // {block number} When this issuance queue was initialized
        address[] tokens; // Addresses of the erc20 tokens modelled by deposits in this queue
        uint256 processed; // Largest index into items that's already been used
        uint256 end; // Largest index into items that's currently-valid. (Avoid needless deletes)
        // TODO: rename "processed" and "end" to be more obviously parallel? "left" and "right", "start" and "end"?
        TotalIssue[] items; // The actual queue of items
    }
    /* An initialized IssueQueue should start with a zero-value item.
     * If we want to clean up state, it's safe to delete items[x] iff x < processed.
     * For an initialized IssueQueue iq:
     *     iq.items.end >= processed
     *     iq.items.end == processed  iff  there are no more pending issuances here
     */

    mapping(address => IssueQueue) public issueQueues;

    Fix public override basketsNeeded; // {BU}

    constructor(
        IMain main_,
        string memory name_,
        string memory symbol_,
        address owner_
    ) ERC20(name_, symbol_) ERC20Permit(name_) {
        main = main_;
        _transferOwnership(owner_);
    }

    modifier onlyMain() {
        require(_msgSender() == address(main), "only main");
        _;
    }

    /// Begins the SlowIssuance accounting process, keeping a roughly constant basket rate
    /// @dev This function assumes that `deposits` are transferred here during this txn.
    /// @dev This function assumes that `amtBaskets` will be due to issuer after slow issuance.
    /// @param issuer The account issuing the RToken
    /// @param amtRToken {qRTok}
    /// @param amtBaskets {BU}
    /// @param erc20s {address[]}
    /// @param deposits {qRTok[]}
    function issue(
        address issuer,
        uint256 amtRToken,
        Fix amtBaskets,
        address[] memory erc20s,
        uint256[] memory deposits
    ) external override onlyMain {
        assert(erc20s.length == deposits.length);

        // Calculate the issuance rate if this is the first issue in the block
        if (lastIssRateBlock < block.number) {
            lastIssRateBlock = block.number;
            lastIssRate = fixMax(MIN_ISS_RATE, main.issuanceRate().mulu(totalSupply()));
        }

        IssueQueue storage queue = issueQueues[issuer];

        // ensure that the queue models the current basket;
        // Does erc20s == queue.tokens?
        bool equal = (erc20s.length == queue.tokens.length);
        for (uint256 i = 0; equal && i < erc20s.length; i++) {
            if (erc20s[i] != queue.tokens[i]) equal = false;
        }
        if (!equal) {
            refundSpan(queue, queue.processed, queue.end);
            delete queue.items; // TODO: O(n)?
        }

        // ensure that the queue is initialized
        if (queue.items.length == 0) {
            queue.whenInitialized = block.number;
            delete queue.tokens;
            for (uint256 i = 0; i < erc20s.length; i++) queue.tokens.push(erc20s[i]);
            queue.processed = 0;
            queue.end = 0;

            TotalIssues storage zero = queue.items.push();
            zero.when = block.number;
            zero.amtRToken = 0;
            zero.amtBaskets = FIX_ZERO;
            for (uint256 i = 0; i < deposits.length; i++) zero.deposits.push(0);
        }

        // what conditions am I relying on?
        // - queue.items is non-empty (init'd)
        // - previous deposit arrays in `queue` correspond to the same sequence of erc20 tokens
        //   as `deposits` does here
        // TODO double-check that they're ensured!

        // Add amtRToken's worth of issuance delay to allVestAt
        allVestAt = fixMin(allVestAt, toFix(block.number)).plus(divFix(amtRToken, lastIssRate));

        // Push issuance onto queue
        TotalIssues storage prev = queue.items[queue.items.length - 1];
        TotalIssues storage curr = queue.items.push();

        curr.when = allVestAt.floor();
        curr.amtRToken = prev.amtRToken + amtRToken;
        curr.amtBasket = prev.amtBaskets + amtBaskets;
        for (uint256 i = 0; i < deposits.length; i++) {
            curr.deposits[i] = prev.deposits[i] + deposits[i];
        }
        queue.end++;

        // emit issuancestarted
        // TODO

        // complete immediately if it fits into this block
        // TODO
    }

    /// Cancel a vesting issuance
    /// @param account The account of the issuer, and caller
    /// @param index The index of the issuance in the issuer's queue
    function cancel(
        address account,
        uint256 amount,
        bool earliest //
    ) external override returns (uint256[] deposits) {
        account = _msgSender();
        require(account == _msgSender(), "issuer does not match caller");

        // cancel issuances
        IssueQueue storage queue = issueQueues[issuer];
        TotalIssue[] items = queue.items;
        uint256 amtPending = items[items.length - 1].amtRToken - items[queue.processed].amtRToken;
        require(amtPending >= amount, "Not enough RToken issuance is pending.");

        if (earliest) {
            // Find least n so that items[n].amtRToken >= items[queue.processed].amtRToken + amount
            uint256 newFloor = items[queue.processed].amtRToken + amount;

            // ... using binary search, where always (left < n <= right)
            uint256 left = queue.processed - 1; // largest value that we already know is < n
            uint256 right = queue.end; // smallest value that we already know is >= n
            while (left < right - 1) {
                uint256 test = (left + right) / 2;
                if (items[test].amtRToken >= newFloor) right = test;
                else left = test;
            }
            uint256 n = right;
            // Do refunds and bump queue.processed
            if (items[n].amtRToken == newFloor) {
                refundSpan(account, queue.processed, n + 1);
                queue.processed = n;
            } else {
                if (n > queue.processed) refundSpan(account, queue.processed, n);
                refundPartial(account, items[n].amtRToken - newFloor, n);
                queue.processed = n - 1;
            }
        } else {
            // Find greatest n so that items[n].amtRToken <= items[len-1].amtRtoken - amount
            uint256 newCeil = items[queue.end].amtRToken - amount;
            uint256 n;
            // ... using binary search, where always left <= n < right:
            uint256 left = queue.processed; // largest value that we already know is <= n
            uint256 right = queue.end + 1; // smallest value that we already know is > n
            while (left < right - 1) {
                uint256 test = (left + right) / 2;
                if (items[test].amtRToken <= newCeil) left = test;
                else right = test;
            }
            uint256 n = right;
            // Do refunds and reduce queue.end
            // TODO
        }

        // emit issuancecanceled
        // TODO
    }

    /// Refund all RToken issuance between index left and index right
    function refundSpan(
        address account,
        uint256 left,
        uint256 right
    ) private {
        // TODO
    }

    /// Refund amount RToken from between index n-1 and index n.
    function refundPartial(
        address account,
        uint256 amount,
        uint256 n
    ) private {
        // TODO
    }

    /// Vest all available issuance for the account
    /// Callable by anyone!
    /// @param account The address of the account to vest issuances for
    /// @return vested {qRTok} The total amtRToken of RToken quanta vested
    // TODO P1: modify for cumulative issuance
    function vest(address account) external override returns (uint256 vested) {
        require(!main.paused(), "main is paused");
        require(main.worstCollateralStatus() == CollateralStatus.SOUND, "collateral default");

        IssueQueue storage queue = issueQueues[issuer];

        // ensure the queue models the current basket
        // TODO find the most recently-vested TotalIssue
        //
    }

    /// Redeem a quantity of RToken from an account, keeping a roughly constant basket rate
    /// @param from The account redeeeming RToken
    /// @param amtRToken {qRTok} The amtRToken to be redeemed
    /// @param amtBaskets {BU}
    function redeem(
        address from,
        uint256 amtRToken,
        Fix amtBaskets
    ) external override onlyMain {
        _burn(from, amtRToken);

        emit BasketsNeededChanged(basketsNeeded, basketsNeeded.minus(amtBaskets));
        basketsNeeded = basketsNeeded.minus(amtBaskets);

        assert(basketsNeeded.gte(FIX_ZERO));
    }

    /// Mint a quantity of RToken to the `recipient`, decreasing the basket rate
    /// @param recipient The recipient of the newly minted RToken
    /// @param amtRToken {qRTok} The amtRToken to be minted
    function mint(address recipient, uint256 amtRToken) external override onlyMain {
        _mint(recipient, amtRToken);
    }

    /// Melt a quantity of RToken from the caller's account, increasing the basket rate
    /// @param amtRToken {qRTok} The amtRToken to be melted
    function melt(uint256 amtRToken) external override {
        _burn(_msgSender(), amtRToken);
        emit Melted(amtRToken);
    }

    /// An affordance of last resort for Main in order to ensure re-capitalization
    function setBasketsNeeded(Fix basketsNeeded_) external override onlyMain {
        emit BasketsNeededChanged(basketsNeeded, basketsNeeded_);
        basketsNeeded = basketsNeeded_;
    }

    function setMain(IMain main_) external override onlyOwner {
        emit MainSet(main, main_);
        main = main_;
    }

    // ==== Private ====
    /** Ensure that `account's` issuance queue is initialized, and only models issuances against the
     * current basket. If it contains issuances against old baskets, cancel them.
     * @dev This does *not* force possible vesting.
     */
    function ensureQueueUpToDate(IssueQueue storage queue) {
        // ensure that the queue models issuances against the current basket, not previous baskets
        if (queue.blockLastChanged < main.blockBasketLastChanged()) {
            // refund all issuances
            ____refundAll();
        }
    }

    // ==== Old Private ====
    /// Old issuance vesting. TODO: DELETE
    /// @return issued The total amtRToken of RToken minted
    // P1: surely changes entirely
    function tryVestIssuance(address issuer, uint256 index) internal returns (uint256 issued) {
        SlowIssuance storage iss = issuances[issuer][index];
        if (
            !iss.processed &&
            iss.blockStartedAt > main.blockBasketLastChanged() &&
            iss.blockAvailableAt.lte(toFix(block.number))
        ) {
            for (uint256 i = 0; i < iss.erc20s.length; i++) {
                IERC20(iss.erc20s[i]).safeTransfer(address(main), iss.deposits[i]);
            }
            _mint(iss.issuer, iss.amtRToken);
            issued = iss.amtRToken;

            emit BasketsNeededChanged(basketsNeeded, basketsNeeded.plus(iss.amtBaskets));
            basketsNeeded = basketsNeeded.plus(iss.amtBaskets);

            iss.processed = true;
            emit IssuanceCompleted(issuer, index);
        }
    }
}
