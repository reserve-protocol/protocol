// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/draft-ERC20Permit.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "contracts/interfaces/IMain.sol";
import "contracts/interfaces/IRToken.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/p0/Rewardable.sol";

/**
 * @title RToken
 * @notice An ERC20 with an elastic supply and governable exchange rate to basket units.
 */
contract RToken is RewardableP0, ERC20Permit, IRToken {
    using EnumerableSet for EnumerableSet.AddressSet;
    using FixLib for Fix;
    using SafeERC20 for IERC20;

    Fix public constant MIN_ISS_RATE = Fix.wrap(1e40); // {qRTok/block} 10k whole RTok

    // Enforce a fixed issuanceRate throughout the entire block by caching it.
    Fix public lastIssRate; // {qRTok/block}
    uint256 public lastIssRateBlock; // {block number}

    // When the all pending issuances will have vested.
    // This is fractional so that we can represent partial progress through a block.
    Fix public allVestAt; // {fractional block number}

    // IssueItem: One edge of an issuance
    struct IssueItem {
        uint256 when; // {block number}
        uint256 amtRToken; // {qRTok} Total amount of RTokens that have vested by `when`
        Fix amtBaskets; // {BU} Total amount of baskets that should back those RTokens
        uint256[] deposits; // {qTok}, Total amounts of basket collateral deposited for vesting
    }

    struct IssueQueue {
        uint256 basketNonce; // The nonce of the basket this queue models deposits against
        address[] tokens; // Addresses of the erc20 tokens modelled by deposits in this queue
        uint256 left; // Largest index into items that's already been used
        uint256 right; // Largest index into items that's currently-valid. (Avoid needless deletes)
        IssueItem[] items; // The actual items (The issuance "fenceposts")
    }
    /* An initialized IssueQueue should start with a zero-value item.
     * If we want to clean up state, it's safe to delete items[x] iff x < left.
     * For an initialized IssueQueue queue:
     *     queue.items.right >= left
     *     queue.items.right == left  iff  there are no more pending issuances here
     *
     * The short way to describe this is that IssueQueue stores _cumulative_ issuances, not raw
     * issuances, and so any particular issuance is actually the _difference_ between two adjaacent
     * TotalIssue items in an IssueQueue.
     *
     * The way to keep an IssueQueue striaght in your head is to think of each TotalIssue item as a
     * "fencpost" in the queue of actual issuances. The true issuances are the spans between the
     * TotalIssue items. For example, if:
     *    queue.items[queue.left].amtRToken == 1000 , and
     *    queue.items[queue.right].amtRToken == 6000,
     * then the issuance "between" them is 5000 RTokens. If we waited long enough and then called
     * vest() on that account, we'd vest 5000 RTokens *to* that account.
     */

    mapping(address => IssueQueue) public issueQueues;

    Fix public basketsNeeded; // {BU}

    Fix public issuanceRate; // {%} of RToken supply to issue per block

    // solhint-disable no-empty-blocks
    constructor(string memory name_, string memory symbol_)
        ERC20(name_, symbol_)
        ERC20Permit(name_)
    {}

    // solhint-enable no-empty-blocks

    function init(ConstructorArgs calldata args) internal override {
        issuanceRate = args.params.issuanceRate;
        emit IssuanceRateSet(FIX_ZERO, issuanceRate);
    }

    function setIssuanceRate(Fix val) external onlyOwner {
        emit IssuanceRateSet(issuanceRate, val);
        issuanceRate = val;
    }

    /// Begins the SlowIssuance accounting process, keeping a roughly constant basket rate
    /// @dev This function assumes that `deposits` are transferred here during this txn.
    /// @dev This function assumes that `amtBaskets` will be due to issuer after slow issuance.
    /// @param account The account issuing the RToken
    /// @param amtRToken {qRTok}
    /// @param amtBaskets {BU}
    /// @param erc20s {address[]}
    /// @param deposits {qRTok[]}
    function issue(
        address account,
        uint256 amtRToken,
        Fix amtBaskets,
        address[] memory erc20s,
        uint256[] memory deposits
    ) external onlyComponent {
        assert(erc20s.length == deposits.length);
        IssueQueue storage queue = issueQueues[account];
        refundOldBasketIssues(account);

        // Calculate the issuance rate if this is the first issue in the block
        if (lastIssRateBlock < block.number) {
            lastIssRateBlock = block.number;
            lastIssRate = fixMax(MIN_ISS_RATE, issuanceRate.mulu(totalSupply()));
        }

        (uint256 basketNonce, ) = main.basketHandler().lastSet();

        // Ensure that the queue is initialized, and models the current basket
        if (queue.items.length == 0 || queue.basketNonce < basketNonce) {
            queue.basketNonce = basketNonce;
            queue.tokens = erc20s;
            queue.left = 0;
            queue.right = 0;

            IssueItem storage zero = queue.items.length == 0 ? queue.items.push() : queue.items[0];
            zero.when = block.number;
            zero.amtRToken = 0;
            zero.amtBaskets = FIX_ZERO;
            zero.deposits = new uint256[](erc20s.length);
        }

        assert(queue.items.length > 0);
        assert(queue.basketNonce == basketNonce);

        // Add amtRToken's worth of issuance delay to allVestAt
        allVestAt = fixMin(allVestAt, toFix(block.number)).plus(divFix(amtRToken, lastIssRate));

        // Push issuance onto queue
        IssueItem storage prev = queue.items[queue.right];
        IssueItem storage curr = queue.items.length == queue.right + 1
            ? queue.items.push()
            : queue.items[queue.right + 1];

        curr.when = allVestAt.floor();
        curr.amtRToken = prev.amtRToken + amtRToken;
        curr.amtBaskets = prev.amtBaskets.plus(amtBaskets);
        for (uint256 i = 0; i < deposits.length; i++) {
            curr.deposits[i] = prev.deposits[i] + deposits[i];
        }
        queue.right++;

        emit IssuanceStarted(
            account,
            queue.right,
            amtRToken,
            amtBaskets,
            erc20s,
            deposits,
            allVestAt
        );

        // Vest immediately if the vesting fits into this block.
        if (allVestAt.floor() <= block.number) vestThrough(account, queue.right);
    }

    /// Vest all available issuance for the account
    /// Callable by anyone!
    /// @param account The address of the account to vest issuances for
    /// @return vested {qRTok} The total amtRToken of RToken quanta vested
    function vest(address account) external returns (uint256 vested) {
        require(!main.paused(), "main is paused");
        require(main.basketHandler().status() == CollateralStatus.SOUND, "collateral default");

        IssueQueue storage queue = issueQueues[account];
        refundOldBasketIssues(account);
        (, uint256 basketTimestamp) = main.basketHandler().lastSet();
        assert(queue.left == queue.right || queue.basketNonce == basketTimestamp);

        // Handle common edge cases in O(1)
        if (queue.left == queue.right) return 0;
        if (block.timestamp < queue.items[queue.left].when) return 0;
        if (queue.items[queue.right].when <= block.timestamp) {
            return vestThrough(account, queue.right);
        }

        // find left = right-1 such that: queue[left].when <= block.timestamp < queue[right].when
        // using binary search, where always left <= right, and
        //     queue[left].when <= block.timestamp < queue[right].when
        uint256 left = queue.left + 1;
        uint256 right = queue.right;
        while (left < right - 1) {
            uint256 test = (left + right) / 2;
            if (queue.items[test].when <= block.timestamp) left = test;
            else right = test;
        }

        return vestThrough(account, left);
    }

    /// Cancel some vesting issuance(s)
    /// @param account The account of the issuer, and caller
    /// @param through The issuance index to cancel through
    /// @param earliest If true, cancel earliest issuances; else, cancel latest issuances
    function cancel(
        address account,
        uint256 through,
        bool earliest
    ) external returns (uint256[] memory deposits) {
        require(account == _msgSender(), "issuer does not match caller");
        IssueQueue storage queue = issueQueues[account];

        require(queue.left <= through && through <= queue.right, "'through' is out of range");

        if (earliest) {
            deposits = refundSpan(account, queue.left, through);
            queue.left = through;
        } else {
            deposits = refundSpan(account, through, queue.right);
            queue.right = through;
        }
    }

    /// Redeem a quantity of RToken from an account, keeping a roughly constant basket rate
    /// @param from The account redeeeming RToken
    /// @param amtRToken {qRTok} The amtRToken to be redeemed
    /// @param amtBaskets {BU}
    function redeem(
        address from,
        uint256 amtRToken,
        Fix amtBaskets
    ) external onlyComponent {
        _burn(from, amtRToken);

        emit BasketsNeededChanged(basketsNeeded, basketsNeeded.minus(amtBaskets));
        basketsNeeded = basketsNeeded.minus(amtBaskets);

        assert(basketsNeeded.gte(FIX_ZERO));
    }

    /// Mint a quantity of RToken to the `recipient`, decreasing the basket rate
    /// @param recipient The recipient of the newly minted RToken
    /// @param amtRToken {qRTok} The amtRToken to be minted
    function mint(address recipient, uint256 amtRToken) external onlyComponent {
        _mint(recipient, amtRToken);
    }

    /// Melt a quantity of RToken from the caller's account, increasing the basket rate
    /// @param amtRToken {qRTok} The amtRToken to be melted
    function melt(uint256 amtRToken) external {
        _burn(_msgSender(), amtRToken);
        emit Melted(amtRToken);
    }

    /// An affordance of last resort for Main in order to ensure re-capitalization
    function setBasketsNeeded(Fix basketsNeeded_) external onlyComponent {
        emit BasketsNeededChanged(basketsNeeded, basketsNeeded_);
        basketsNeeded = basketsNeeded_;
    }

    function setMain(IMain main_) external onlyOwner {
        emit MainSet(main, main_);
        main = main_;
    }

    // ==== private ====
    /// Refund all deposits in the given span.
    /// This does *not* fixup queue.left and queue.right!
    function refundSpan(
        address account,
        uint256 left,
        uint256 right
    ) private returns (uint256[] memory deposits) {
        IssueQueue storage queue = issueQueues[account];
        if (left >= right) return deposits;

        // refund total deposits
        IssueItem storage leftItem = queue.items[queue.left];
        IssueItem storage rightItem = queue.items[right];

        for (uint256 i = 0; i < queue.tokens.length; i++) {
            deposits[i] = rightItem.deposits[i] - leftItem.deposits[i];
            IERC20(queue.tokens[i]).safeTransfer(address(main), deposits[i]);
        }

        // emit issuancesCanceled
        emit IssuancesCanceled(account, left + 1, right);
    }

    /// Vest all RToken issuance in queue = queues[account], from queue.left through index `through`
    /// This *does* fixup queue.left and queue.right!
    function vestThrough(address account, uint256 through) private returns (uint256 amtRToken) {
        IssueQueue storage queue = issueQueues[account];
        assert(queue.left <= through && through <= queue.right); // out-of-bounds error

        // Vest the span up to index `through`.
        IssueItem storage leftItem = queue.items[queue.left];
        IssueItem storage rightItem = queue.items[through];

        for (uint256 i = 0; i < queue.tokens.length; i++) {
            uint256 amtDeposit = rightItem.deposits[i] - leftItem.deposits[i];
            IERC20(queue.tokens[i]).safeTransfer(address(main), amtDeposit);
        }
        amtRToken = rightItem.amtRToken - leftItem.amtRToken;
        _mint(account, amtRToken);

        Fix newBasketsNeeded = basketsNeeded.plus(rightItem.amtBaskets.minus(leftItem.amtBaskets));
        basketsNeeded = newBasketsNeeded;

        emit IssuancesCompleted(account, queue.left + 1, through);
        emit BasketsNeededChanged(basketsNeeded, newBasketsNeeded);

        queue.left = through;
    }

    /// If account's queue models an old basket, refund those issuances.
    function refundOldBasketIssues(address account) private {
        IssueQueue storage queue = issueQueues[account];
        (uint256 basketNonce, ) = main.basketHandler().lastSet();
        // ensure that the queue models issuances against the current basket, not previous baskets
        if (queue.basketNonce != basketNonce) {
            refundSpan(account, queue.left, queue.right);
            queue.left = 0;
            queue.right = 0;
        }
    }
}
