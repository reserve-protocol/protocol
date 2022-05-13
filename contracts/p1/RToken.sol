// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
// solhint-disable-next-line max-line-length
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/draft-ERC20PermitUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "contracts/interfaces/IMain.sol";
import "contracts/interfaces/IRewardable.sol";
import "contracts/interfaces/IRToken.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/p1/mixins/Component.sol";
import "contracts/p1/mixins/RewardableLib.sol";

/**
 * @title RTokenP1
 * @notice An ERC20 with an elastic supply and governable exchange rate to basket units.
 */

/// @custom:oz-upgrades-unsafe-allow external-library-linking
contract RTokenP1 is ComponentP1, IRewardable, ERC20Upgradeable, ERC20PermitUpgradeable, IRToken {
    using FixLib for int192;
    using SafeERC20Upgradeable for IERC20Upgradeable;

    /// Immutable: expected to be an IPFS link but could be anything
    string public constitutionURI;

    // MIN_ISS_RATE: {qRTok/block} 10k whole RTok
    uint256 public constant MIN_ISS_RATE = 10_000 * 1e18;

    // Enforce a fixed issuanceRate throughout the entire block by caching it.
    uint256 public lastIssRate; // {qRTok/block}
    uint256 public lastIssRateBlock; // {block number}

    // When the all pending issuances will have vested.
    // This is fractional so that we can represent partial progress through a block.
    int192 public allVestAt; // {fractional block number}

    // IssueItem: One edge of an issuance
    struct IssueItem {
        int192 when; // {block number} fractional
        uint256 amtRToken; // {qRTok} Total amount of RTokens that have vested by `when`
        int192 amtBaskets; // {BU} Total amount of baskets that should back those RTokens
        uint256[] deposits; // {qTok}, Total amounts of basket collateral deposited for vesting
    }

    struct IssueQueue {
        uint256 basketNonce; // The nonce of the basket this queue models deposits against
        address[] tokens; // Addresses of the erc20 tokens modelled by deposits in this queue
        uint256 left; // [left, right) is the span of currently-valid items
        uint256 right; //
        IssueItem[] items; // The actual items (The issuance "fenceposts")
    }
    /*
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

    int192 public basketsNeeded; // {BU}

    int192 public issuanceRate; // {%} of RToken supply to issue per block

    function init(
        IMain main_,
        string calldata name_,
        string calldata symbol_,
        string calldata constitutionURI_,
        int192 issuanceRate_
    ) external initializer {
        __Component_init(main_);
        __ERC20_init(name_, symbol_);
        __ERC20Permit_init(name_);
        constitutionURI = constitutionURI_;
        issuanceRate = issuanceRate_;
        emit IssuanceRateSet(FIX_ZERO, issuanceRate);
    }

    /// Begin a time-delayed issuance of RToken for basket collateral
    /// @param amtRToken {qTok} The quantity of RToken to issue
    /// @custom:action
    function issue(uint256 amtRToken) external action {
        require(amtRToken > 0, "Cannot issue zero");
        // ==== Basic Setup ====
        main.assetRegistry().forceUpdates_sub(); // no need to checkBasket
        main.furnace().melt_sub();

        IBasketHandler bh = main.basketHandler();
        CollateralStatus status = bh.status();
        require(status != CollateralStatus.DISABLED, "basket disabled");

        // Refund issuances against previous baskets
        address issuer = _msgSender();
        refundOldBasketIssues(issuer);

        // ==== Compute and accept collateral ====
        int192 amtBaskets = (totalSupply() > 0) // {BU}
            ? basketsNeeded.muluDivu(amtRToken, totalSupply()) // {BU * qRTok / qRTok}
            : shiftl_toFix(amtRToken, -int8(decimals())); // {qRTok / qRTok}

        (uint256 basketNonce, ) = bh.lastSet();
        (address[] memory erc20s, uint256[] memory deposits) = bh.quote(amtBaskets, CEIL);

        IssueQueue storage queue = issueQueues[issuer];
        assert(queue.basketNonce == basketNonce || (queue.left == 0 && queue.right == 0));

        // Add amtRToken's worth of issuance delay to allVestAt
        int192 vestingEnd = whenFinished(amtRToken);

        // Bypass queue entirely if the issuance can fit in this block
        if (vestingEnd.lte(toFix(block.number)) && queue.left == queue.right) {
            require(status == CollateralStatus.SOUND, "collateral not sound");
            for (uint256 i = 0; i < erc20s.length; ++i) {
                IERC20Upgradeable(erc20s[i]).safeTransferFrom(
                    issuer,
                    address(main.backingManager()),
                    deposits[i]
                );
            }

            // Complete issuance now
            _mint(issuer, amtRToken);
            int192 newBasketsNeeded = basketsNeeded.plus(amtBaskets);
            emit BasketsNeededChanged(basketsNeeded, newBasketsNeeded);
            basketsNeeded = newBasketsNeeded;

            // Note: We don't need to update the prev queue entry because queue.left = queue.right
            emit IssuancesCompleted(issuer, queue.left, queue.right); // TODO: Breaks Explorer?
            return;
        }

        // Accept collateral
        for (uint256 i = 0; i < erc20s.length; ++i) {
            IERC20Upgradeable(erc20s[i]).safeTransferFrom(issuer, address(this), deposits[i]);
        }

        // Push issuance onto queue
        IssueItem storage curr = queue.items.push();
        curr.when = vestingEnd;
        curr.amtRToken = amtRToken;
        curr.amtBaskets = amtBaskets;
        curr.deposits = deposits;

        // Accumulate
        if (queue.right > 0) {
            IssueItem storage prev = queue.items[queue.right - 1];
            curr.amtRToken = prev.amtRToken + amtRToken;
            curr.amtBaskets = prev.amtBaskets.plus(amtBaskets);
            for (uint256 i = 0; i < deposits.length; ++i) {
                curr.deposits[i] = prev.deposits[i] + deposits[i];
            }
        }

        // Configure queue
        queue.basketNonce = basketNonce;
        queue.tokens = erc20s;
        queue.right++;

        emit IssuanceStarted(
            issuer,
            queue.right - 1,
            amtRToken,
            amtBaskets,
            erc20s,
            deposits,
            vestingEnd
        );
    }

    /// Add amtRToken's worth of issuance delay to allVestAt, and return the resulting finish time.
    /// @return finished the new value of allVestAt
    function whenFinished(uint256 amtRToken) private returns (int192 finished) {
        // Calculate the issuance rate (if this is the first issuance in the block)
        if (lastIssRateBlock < block.number) {
            lastIssRateBlock = block.number;
            lastIssRate = Math.max(MIN_ISS_RATE, issuanceRate.mulu_toUint(totalSupply()));
        }

        // Add amtRToken's worth of issuance delay to allVestAt
        int192 before = fixMax(allVestAt, toFix(block.number - 1));
        finished = before.plus(FIX_ONE.muluDivu(amtRToken, lastIssRate));
        allVestAt = finished;
    }

    /// Vest all available issuance for the account
    /// Callable by anyone!
    /// @param account The address of the account to vest issuances for
    /// @custom:action
    function vest(address account, uint256 endId) external action {
        main.assetRegistry().forceUpdates_sub();
        require(main.basketHandler().status() == CollateralStatus.SOUND, "collateral default");

        refundOldBasketIssues(account);
        vestUpTo(account, endId);
    }

    /// @return A non-inclusive ending index
    function endIdForVest(address account) external view returns (uint256) {
        IssueQueue storage queue = issueQueues[account];
        int192 blockNumber = toFix(block.number);

        // Handle common edge cases in O(1)
        if (queue.left == queue.right) return queue.left;
        if (blockNumber.lt(queue.items[queue.left].when)) return queue.left;
        if (queue.items[queue.right - 1].when.lte(blockNumber)) return queue.right;

        // find left and right (using binary search where always left <= right) such that:
        //     left == right - 1
        //     queue[left].when <= block.timestamp
        //     right == queue.right  or  block.timestamp < queue[right].when
        uint256 left = queue.left;
        uint256 right = queue.right;
        while (left < right - 1) {
            uint256 test = (left + right) / 2;
            if (queue.items[test].when < blockNumber) left = test;
            else right = test;
        }
        return right;
    }

    /// Cancel some vesting issuance(s)
    /// If earliest == true, cancel id if id < endId
    /// If earliest == false, cancel id if endId <= id
    /// @param endId The issuance index to cancel through
    /// @param earliest If true, cancel earliest issuances; else, cancel latest issuances
    /// @custom:action
    function cancel(uint256 endId, bool earliest) external action {
        address account = _msgSender();
        IssueQueue storage queue = issueQueues[account];

        require(queue.left <= endId && endId <= queue.right, "'endId' is out of range");

        if (earliest) {
            refundSpan(account, queue.left, endId);
        } else {
            refundSpan(account, endId, queue.right);
            queue.right = endId;
        }
    }

    /// Redeem RToken for basket collateral
    /// @param amount {qTok} The quantity {qRToken} of RToken to redeem
    /// @custom:action
    function redeem(uint256 amount) external action {
        address redeemer = _msgSender();
        require(amount > 0, "Cannot redeem zero");
        require(balanceOf(redeemer) >= amount, "not enough RToken");

        // Call collective state keepers
        main.assetRegistry().forceUpdates_sub();

        IBasketHandler bh = main.basketHandler();
        bh.checkBasket_sub();

        // Allow redemption during IFFY
        require(bh.status() != CollateralStatus.DISABLED, "collateral default");

        main.furnace().melt_sub();
        int192 basketsNeeded_ = basketsNeeded; // gas optimization

        // {BU} = {BU} * {qRTok} / {qRTok}
        int192 baskets = basketsNeeded_.muluDivu(amount, totalSupply());
        assert(baskets.lte(basketsNeeded_));
        emit Redemption(redeemer, amount, baskets);

        (address[] memory erc20s, uint256[] memory amounts) = bh.quote(baskets, FLOOR);

        // {1} = {qRTok} / {qRTok}
        int192 prorate = toFix(amount).divu(totalSupply());

        // Accept and burn RToken
        _burn(redeemer, amount);

        basketsNeeded = basketsNeeded_.minus(baskets);
        emit BasketsNeededChanged(basketsNeeded_, basketsNeeded);

        // ==== Send back collateral tokens ====
        IBackingManager backingMgr = main.backingManager();
        uint256 erc20length = erc20s.length;
        for (uint256 i = 0; i < erc20length; ++i) {
            // Bound each withdrawal by the prorata share, in case we're currently under-capitalized

            // {qTok} = {1} * {qTok}
            uint256 prorata = prorate.mulu_toUint(IERC20(erc20s[i]).balanceOf(address(backingMgr)));
            amounts[i] = Math.min(amounts[i], prorata);
            // Send withdrawal
            IERC20Upgradeable(erc20s[i]).safeTransferFrom(
                address(backingMgr),
                redeemer,
                amounts[i]
            );
        }
    }

    /// Mint a quantity of RToken to the `recipient`, decreasing the basket rate
    /// @param recipient The recipient of the newly minted RToken
    /// @param amtRToken {qRTok} The amtRToken to be minted
    /// @custom:subroutine
    function mint(address recipient, uint256 amtRToken) external subroutine {
        require(_msgSender() == address(main.backingManager()), "not backing manager");
        _mint(recipient, amtRToken);
    }

    /// Melt a quantity of RToken from the caller's account, increasing the basket rate
    /// @param amtRToken {qRTok} The amtRToken to be melted
    function melt(uint256 amtRToken) external notPaused {
        _burn(_msgSender(), amtRToken);
        emit Melted(amtRToken);
    }

    /// An affordance of last resort for Main in order to ensure re-capitalization
    /// @custom:subroutine
    function setBasketsNeeded(int192 basketsNeeded_) external subroutine {
        require(_msgSender() == address(main.backingManager()), "not backing manager");
        emit BasketsNeededChanged(basketsNeeded, basketsNeeded_);
        basketsNeeded = basketsNeeded_;
    }

    /// Claim all rewards and sweep to BackingManager
    /// @custom:action
    function claimAndSweepRewards() external action {
        RewardableLibP1.claimAndSweepRewards();
    }

    /// @custom:governance
    function setIssuanceRate(int192 val) external governance {
        emit IssuanceRateSet(issuanceRate, val);
        issuanceRate = val;
    }

    /// @return {UoA/rTok} The protocol's best guess of the RToken price on markets
    function price() external view returns (int192) {
        if (totalSupply() == 0) return main.basketHandler().price();

        int192 supply = shiftl_toFix(totalSupply(), -int8(decimals()));
        // {UoA/rTok} = {UoA/BU} * {BU} / {rTok}
        return main.basketHandler().price().mul(basketsNeeded).div(supply);
    }

    /// @dev This function is only here because solidity can't autogenerate our getter
    function issueItem(address account, uint256 index) external view returns (IssueItem memory) {
        return issueQueues[account].items[index];
    }

    // ==== private ====
    /// Refund all deposits in the span [left, right)
    function refundSpan(
        address account,
        uint256 left,
        uint256 right
    ) private {
        IssueQueue storage queue = issueQueues[account];
        assert(queue.left <= left && right <= queue.right);
        if (left >= right) return;

        // compute total deposits
        IssueItem storage rightItem = queue.items[right - 1];
        if (queue.left == 0) {
            for (uint256 i = 0; i < queue.tokens.length; ++i) {
                IERC20Upgradeable(queue.tokens[i]).safeTransfer(account, rightItem.deposits[i]);
            }
        } else {
            IssueItem storage leftItem = queue.items[queue.left - 1];
            for (uint256 i = 0; i < queue.tokens.length; ++i) {
                IERC20Upgradeable(queue.tokens[i]).safeTransfer(
                    account,
                    rightItem.deposits[i] - leftItem.deposits[i]
                );
            }
        }
        queue.left = right;

        // emit issuancesCanceled
        emit IssuancesCanceled(account, left, right);
    }

    /// Vest all RToken issuance in queue = queues[account], from queue.left to < endId
    /// This *does* fixup queue.left and queue.right!
    function vestUpTo(address account, uint256 endId) private {
        IssueQueue storage queue = issueQueues[account];
        if (queue.left == endId) return;
        assert(queue.left < endId && endId <= queue.right); // out- of-bounds error

        // Vest the span up to `endId`.
        uint256 amtRTokenToMint;
        int192 newBasketsNeeded;
        IssueItem storage rightItem = queue.items[endId - 1];
        uint256 queueLength = queue.tokens.length;
        if (queue.left == 0) {
            for (uint256 i = 0; i < queueLength; ++i) {
                uint256 amtDeposit = rightItem.deposits[i];
                IERC20Upgradeable(queue.tokens[i]).safeTransfer(
                    address(main.backingManager()),
                    amtDeposit
                );
            }
            amtRTokenToMint = rightItem.amtRToken;
            newBasketsNeeded = basketsNeeded.plus(rightItem.amtBaskets);
        } else {
            IssueItem storage leftItem = queue.items[queue.left - 1];
            for (uint256 i = 0; i < queueLength; ++i) {
                uint256 amtDeposit = rightItem.deposits[i] - leftItem.deposits[i];
                IERC20Upgradeable(queue.tokens[i]).safeTransfer(
                    address(main.backingManager()),
                    amtDeposit
                );
            }
            amtRTokenToMint = rightItem.amtRToken - leftItem.amtRToken;
            newBasketsNeeded = basketsNeeded.plus(rightItem.amtBaskets).minus(leftItem.amtBaskets);
        }

        _mint(account, amtRTokenToMint);
        emit BasketsNeededChanged(basketsNeeded, newBasketsNeeded);
        basketsNeeded = newBasketsNeeded;

        emit IssuancesCompleted(account, queue.left, endId);
        queue.left = endId;
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
