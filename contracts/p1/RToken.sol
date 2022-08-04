// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

// solhint-disable-next-line max-line-length
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/draft-ERC20PermitUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "contracts/interfaces/IMain.sol";
import "contracts/interfaces/IRewardable.sol";
import "contracts/interfaces/IRToken.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/p1/mixins/Component.sol";
import "contracts/p1/mixins/RewardableLib.sol";

// MIN_BLOCK_ISSUANCE_LIMIT: {rTok/block} 10k whole RTok
uint192 constant MIN_BLOCK_ISSUANCE_LIMIT = 10_000 * FIX_ONE;

// MAX_ISSUANCE_RATE: 100%
uint192 constant MAX_ISSUANCE_RATE = 1e18; // {%}

/**
 * @title RTokenP1
 * @notice An ERC20 with an elastic supply and governable exchange rate to basket units.
 */

contract RTokenP1 is ComponentP1, IRewardable, ERC20PermitUpgradeable, IRToken {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    /// Immutable: expected to be an IPFS link but could be anything
    string public manifestoURI;

    // Enforce a fixed issuanceRate throughout the entire block by caching it.
    uint192 public lastIssRate; // D18{rTok/block}
    uint256 public lastIssRateBlock; // {block number}

    // When all pending issuances will have vested.
    // This is fractional so that we can represent partial progress through a block.
    uint192 public allVestAt; // D18{fractional block number}

    // IssueItem: One edge of an issuance
    struct IssueItem {
        uint192 when; // D18{block number} fractional
        uint256 amtRToken; // {qRTok} Total amount of RTokens that have vested by `when`
        uint192 amtBaskets; // D18{BU} Total amount of baskets that should back those RTokens
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
     * "fencepost" in the queue of actual issuances. The true issuances are the spans between the
     * TotalIssue items. For example, if:
     *    queue.items[queue.left].amtRToken == 1000 , and
     *    queue.items[queue.right].amtRToken == 6000,
     * then the issuance "between" them is 5000 RTokens. If we waited long enough and then called
     * vest() on that account, we'd vest 5000 RTokens *to* that account.
     */

    mapping(address => IssueQueue) public issueQueues;

    uint192 public basketsNeeded; // D18{BU}

    uint192 public issuanceRate; // D18{%} of RToken supply to issue per block

    function init(
        IMain main_,
        string calldata name_,
        string calldata symbol_,
        string calldata manifestoURI_,
        uint192 issuanceRate_
    ) external initializer {
        __Component_init(main_);
        __ERC20_init(name_, symbol_);
        __ERC20Permit_init(name_);
        manifestoURI = manifestoURI_;
        setIssuanceRate(issuanceRate_);
    }

    /// Begin a time-delayed issuance of RToken for basket collateral
    /// @param amtRToken {qTok} The quantity of RToken to issue
    /// @custom:interaction almost but not quite CEI
    function issue(uint256 amtRToken) external notPausedOrFrozen {
        if (amtRToken == 0) revert ZeroAmount();

        // == Refresh ==
        main.assetRegistry().refresh();

        address issuer = _msgSender(); // OK to save: it can't be changed in reentrant runs
        IBasketHandler bh = main.basketHandler(); // OK to save: can only be changed by gov

        (uint256 basketNonce, ) = bh.lastSet();
        IssueQueue storage queue = issueQueues[issuer];

        // Refund issuances against old baskets
        if (queue.basketNonce != basketNonce) {
            // == Interaction ==
            // This violates simple CEI, so we have to renew any potential transient state!
            refundSpan(issuer, queue.left, queue.right);

            // Refresh collateral after interaction
            main.assetRegistry().refresh();

            // Refresh local values after potential reentrant changes to contract state.
            (basketNonce, ) = bh.lastSet();
            queue = issueQueues[issuer];
        }

        // == Checks-effects block ==
        CollateralStatus status = bh.status();
        if (status != CollateralStatus.SOUND) revert UnsoundBasket(status);

        main.furnace().melt();

        // ==== Compute and accept collateral ====
        // D18{BU} = D18{BU} * {qRTok} / {qRTok}
        // Downcast is safe because an actual quantity of qBUs fits in uint192
        uint192 amtBaskets = uint192(
            totalSupply() > 0 ? mulDiv256(basketsNeeded, amtRToken, totalSupply()) : amtRToken
        );

        (address[] memory erc20s, uint256[] memory deposits) = bh.quote(amtBaskets, CEIL);

        // Add amtRToken's worth of issuance delay to allVestAt
        uint192 vestingEnd = whenFinished(amtRToken); // D18{block number}

        // Bypass queue entirely if the issuance can fit in this block and nothing blocking
        if (
            // D18{blocks} <= D18{1} * {blocks}
            vestingEnd <= FIX_ONE_256 * block.number &&
            queue.left == queue.right &&
            status == CollateralStatus.SOUND
        ) {
            // Complete issuance
            _mint(issuer, amtRToken);
            // Fixlib optimization:
            // D18{BU} = D18{BU} + D18{BU}; uint192(+) is the same as Fix.plus
            uint192 newBasketsNeeded = basketsNeeded + amtBaskets;
            emit BasketsNeededChanged(basketsNeeded, newBasketsNeeded);
            basketsNeeded = newBasketsNeeded;

            // Note: We don't need to update the prev queue entry because queue.left = queue.right
            emit Issuance(issuer, amtRToken, amtBaskets);

            address backingMgr = address(main.backingManager());

            // == Interactions then return: transfer tokens ==
            for (uint256 i = 0; i < erc20s.length; ++i) {
                IERC20Upgradeable(erc20s[i]).safeTransferFrom(issuer, backingMgr, deposits[i]);
            }
            return;
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
            // D18{BU} = D18{BU} + D18{BU}; uint192(+) is the same as Fix.plus
            curr.amtBaskets = prev.amtBaskets + amtBaskets;
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

        // == Interactions: accept collateral ==
        for (uint256 i = 0; i < erc20s.length; ++i) {
            IERC20Upgradeable(erc20s[i]).safeTransferFrom(issuer, address(this), deposits[i]);
        }
    }

    /// Add amtRToken's worth of issuance delay to allVestAt, and return the resulting finish time.
    /// @return finished D18{block} The new value of allVestAt
    function whenFinished(uint256 amtRToken) private returns (uint192 finished) {
        // Calculate the issuance rate (if this is the first issuance in the block)
        if (lastIssRateBlock < block.number) {
            lastIssRateBlock = block.number;

            // D18{rTok/block} = D18{1/block} * D18{rTok} / D18{1}
            // uint192 downcast is safe, max value representations are 1e18 * 1e48 / 1e18
            lastIssRate = uint192((issuanceRate * totalSupply()) / FIX_ONE);
            // uint192(<) is equivalent to Fix.lt
            if (lastIssRate < MIN_BLOCK_ISSUANCE_LIMIT) lastIssRate = MIN_BLOCK_ISSUANCE_LIMIT;
        }

        // Add amtRToken's worth of issuance delay to allVestAt
        uint192 before = allVestAt; // D18{block number}
        // uint192 downcast is safe: block numbers are smaller than 1e38
        uint192 worst = uint192(FIX_ONE * (block.number - 1)); // D18{block} = D18{1} * {block}
        if (worst > before) before = worst;

        // ... - 1 + lastIssRate gives us division rounding up, instead of down.
        // so, read this as:
        // finished = before + div(uint192((FIX_ONE_256 * amtRToken), lastIssRate, CEIL)
        // finished: D18{block} = D18{block} + D18{1} * D18{RTok} / D18{rtok/block}
        // uint192() downcast here is safe because:
        //   lastIssRate is at least 1e24 (from MIN_ISS_RATE), and
        //   amtRToken is at most 1e48, so
        //   what's downcast is at most (1e18 * 1e48 / 1e24) = 1e38 < 2^192-1
        finished = before + uint192((FIX_ONE_256 * amtRToken - 1 + lastIssRate) / lastIssRate);
        allVestAt = finished;
    }

    /// Vest all available issuance for the account
    /// Callable by anyone!
    /// @param account The address of the account to vest issuances for
    /// @custom:completion
    /// @custom:interaction CEI
    function vest(address account, uint256 endId) external notPausedOrFrozen {
        // == Keepers ==
        main.assetRegistry().refresh();

        // == Checks ==
        CollateralStatus status = main.basketHandler().status();
        if (status != CollateralStatus.SOUND) revert UnsoundBasket(status);

        // Refund old issuances if there are any
        IssueQueue storage queue = issueQueues[account];
        (uint256 basketNonce, ) = main.basketHandler().lastSet();

        // == Interactions ==
        // ensure that the queue models issuances against the current basket, not previous baskets
        if (queue.basketNonce != basketNonce) {
            refundSpan(account, queue.left, queue.right);
        } else {
            vestUpTo(account, endId);
        }
    }

    /// @return A non-inclusive ending index
    function endIdForVest(address account) external view returns (uint256) {
        IssueQueue storage queue = issueQueues[account];
        uint256 blockNumber = FIX_ONE_256 * block.number; // D18{block} = D18{1} * {block}

        // Handle common edge cases in O(1)
        if (queue.left == queue.right) return queue.left;
        if (blockNumber < queue.items[queue.left].when) return queue.left;
        if (queue.items[queue.right - 1].when <= blockNumber) return queue.right;

        // find left and right (using binary search where always left <= right) such that:
        //     left == right - 1
        //     queue[left].when <= block.timestamp
        //     right == queue.right  or  block.timestamp < queue[right].when
        uint256 left = queue.left;
        uint256 right = queue.right;
        while (left < right - 1) {
            uint256 test = (left + right) / 2;
            // In this condition: D18{block} < D18{block}
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
    /// @custom:interaction CEI
    function cancel(uint256 endId, bool earliest) external notFrozen {
        address account = _msgSender();
        IssueQueue storage queue = issueQueues[account];

        if (queue.left < endId || endId < queue.right) revert OutOfRange();

        // == Interactions ==
        if (earliest) {
            refundSpan(account, queue.left, endId);
        } else {
            refundSpan(account, endId, queue.right);
        }
    }

    /// Redeem RToken for basket collateral
    /// @param amount {qTok} The quantity {qRToken} of RToken to redeem
    /// @custom:action
    /// @custom:interaction CEI
    function redeem(uint256 amount) external notFrozen {
        if (amount == 0) revert ZeroAmount();

        // == Refresh ==
        main.assetRegistry().refresh();

        // == Checks and Effects ==
        address redeemer = _msgSender();
        if (balanceOf(redeemer) < amount) revert InsufficientBalance();
        // Allow redemption during IFFY + UNPRICED
        if (main.basketHandler().status() == CollateralStatus.DISABLED) {
            revert UnsoundBasket(CollateralStatus.DISABLED);
        }

        // Failure to melt results in a lower redemption price, so we can allow it when paused
        // solhint-disable-next-line no-empty-blocks
        try main.furnace().melt() {} catch {}

        uint192 basketsNeeded_ = basketsNeeded; // gas optimization

        // D18{BU} = D18{BU} * {qRTok} / {qRTok}
        // downcast is safe: amount < totalSupply and basketsNeeded_ < 1e57 < 2^190 (just barely)
        uint192 baskets = uint192(mulDiv256(basketsNeeded_, amount, totalSupply()));
        emit Redemption(redeemer, amount, baskets);

        (address[] memory erc20s, uint256[] memory amounts) = main.basketHandler().quote(
            uint192(baskets),
            FLOOR
        );

        // ==== Prorate redemption ====
        IBackingManager backingMgr = main.backingManager();
        uint256 erc20length = erc20s.length;

        // D18{1} = D18 * {qRTok} / {qRTok}
        // downcast is safe: amount <= balanceOf(redeemer) <= totalSupply(), so prorate < 1e18
        uint192 prorate = uint192((FIX_ONE_256 * amount) / totalSupply());

        // Bound each withdrawal by the prorata share, in case we're currently under-capitalized
        for (uint256 i = 0; i < erc20length; ++i) {
            // {qTok} = D18{1} * {qTok} / D18
            uint256 prorata = (prorate *
                IERC20Upgradeable(erc20s[i]).balanceOf(address(backingMgr))) / FIX_ONE;
            if (prorata < amounts[i]) amounts[i] = prorata;
        }

        // Accept and burn RToken
        _burn(redeemer, amount);

        basketsNeeded = basketsNeeded_ - baskets;
        emit BasketsNeededChanged(basketsNeeded_, basketsNeeded);

        // == Interactions ==
        bool nonzero = false;
        for (uint256 i = 0; i < erc20length; ++i) {
            if (!nonzero && amounts[i] > 0) nonzero = true;

            // Send withdrawal
            IERC20Upgradeable(erc20s[i]).safeTransferFrom(
                address(backingMgr),
                redeemer,
                amounts[i]
            );
        }

        if (!nonzero) revert EmptyRedemption();
    }

    /// Mint a quantity of RToken to the `recipient`, decreasing the basket rate
    /// @param recipient The recipient of the newly minted RToken
    /// @param amtRToken {qRTok} The amtRToken to be minted
    /// @custom:protected
    function mint(address recipient, uint256 amtRToken) external notPausedOrFrozen {
        if (_msgSender() != address(main.backingManager())) revert OnlyBackingManager();
        _mint(recipient, amtRToken);
    }

    /// Melt a quantity of RToken from the caller's account, increasing the basket rate
    /// @param amtRToken {qRTok} The amtRToken to be melted
    function melt(uint256 amtRToken) external notPausedOrFrozen {
        _burn(_msgSender(), amtRToken);
        emit Melted(amtRToken);
    }

    /// An affordance of last resort for Main in order to ensure re-capitalization
    /// @custom:protected
    function setBasketsNeeded(uint192 basketsNeeded_) external notPausedOrFrozen {
        if (_msgSender() != address(main.backingManager())) revert OnlyBackingManager();
        emit BasketsNeededChanged(basketsNeeded, basketsNeeded_);
        basketsNeeded = basketsNeeded_;
    }

    /// Claim all rewards and sweep to BackingManager
    /// @custom:interaction
    function claimAndSweepRewards() external notPausedOrFrozen {
        RewardableLibP1.claimAndSweepRewards();
    }

    /// @custom:governance
    function setIssuanceRate(uint192 val) public governance {
        if (val > MAX_ISSUANCE_RATE) revert InvalidIssuanceRate();
        emit IssuanceRateSet(issuanceRate, val);
        issuanceRate = val;
    }

    /// @return p D18{UoA/rTok} The protocol's best guess of the redemption price of an RToken
    function price() external view returns (uint192 p) {
        if (totalSupply() == 0) revert TotalSupplyZero();

        // downcast is safe: basketsNeeded is <= 1e39
        // D18{BU} = D18{BU} * D18{rTok} / D18{rTok}
        uint192 amtBUs = uint192((basketsNeeded * FIX_ONE_256) / totalSupply());
        (address[] memory erc20s, uint256[] memory quantities) = main.basketHandler().quote(
            amtBUs,
            FLOOR
        );

        uint256 erc20length = erc20s.length;
        address backingMgr = address(main.backingManager());
        IAssetRegistry assetRegistry = main.assetRegistry();

        // Bound each withdrawal by the prorata share, in case we're currently under-capitalized
        for (uint256 i = 0; i < erc20length; ++i) {
            IAsset asset = assetRegistry.toAsset(IERC20(erc20s[i]));

            // {qTok} =  {qRTok} * {qTok} / {qRTok}
            uint256 prorated = (FIX_ONE_256 * IERC20(erc20s[i]).balanceOf(backingMgr)) /
                (totalSupply());

            if (prorated < quantities[i]) quantities[i] = prorated;

            // D18{tok} = D18 * {qTok} / {qTok/tok}
            uint192 q = shiftl_toFix(quantities[i], -int8(IERC20Metadata(erc20s[i]).decimals()));

            // downcast is safe: total attoUoA from any single asset is well under 1e47
            // D18{UoA} = D18{UoA} + (D18{UoA/tok} * D18{tok} / D18
            p += uint192((asset.price() * uint256(q)) / FIX_ONE);
        }
    }

    /// @dev This function is only here because solidity can't autogenerate our getter
    function issueItem(address account, uint256 index) external view returns (IssueItem memory) {
        return issueQueues[account].items[index];
    }

    // ==== private ====
    /// Refund all deposits in the span [left, right)
    /// after: queue.left == queue.right
    /// @custom:interaction
    function refundSpan(
        address account,
        uint256 left,
        uint256 right
    ) private {
        if (left >= right) return; // refund an empty span

        IssueQueue storage queue = issueQueues[account];

        // compute total deposits to refund
        uint256 tokensLen = queue.tokens.length;
        uint256[] memory amt = new uint256[](tokensLen);
        uint256 amtRToken; // {qRTok}
        IssueItem storage rightItem = queue.items[right - 1];

        // we could dedup this logic but it would take more SLOADS, so I think this is best
        if (left == 0) {
            amtRToken = rightItem.amtRToken;
            for (uint256 i = 0; i < tokensLen; ++i) {
                amt[i] = rightItem.deposits[i];
            }
        } else {
            IssueItem storage leftItem = queue.items[left - 1];
            amtRToken = rightItem.amtRToken - leftItem.amtRToken;
            for (uint256 i = 0; i < tokensLen; ++i) {
                amt[i] = rightItem.deposits[i] - leftItem.deposits[i];
            }
        }

        // Check the relationships of these intervals, and set queue.{left, right} to final values.
        if (queue.left == left && right <= queue.right) {
            // refund from beginning of queue
            queue.left = right;
        } else if (queue.left < left && right == queue.right) {
            // refund from end of queue
            queue.right = left;
        } else {
            // error: can't remove [left,right) from the queue, and leave just one interval
            revert BadRefundSpan();
        }

        emit IssuancesCanceled(account, left, right, amtRToken);

        // == Interactions ==
        for (uint256 i = 0; i < queue.tokens.length; ++i) {
            IERC20Upgradeable(queue.tokens[i]).safeTransfer(account, amt[i]);
        }
    }

    /// Vest all RToken issuance in queue = queues[account], from queue.left to < endId
    /// Fixes up queue.left and queue.right
    /// @custom:interaction
    function vestUpTo(address account, uint256 endId) private {
        IssueQueue storage queue = issueQueues[account];
        if (queue.left == endId) return;

        if (queue.left < endId || endId < queue.right) revert OutOfRange();

        // Vest the span up to `endId`.
        uint256 amtRToken;
        uint192 amtBaskets;
        IssueItem storage rightItem = queue.items[endId - 1];
        // D18{block} ~~ D18 * {block}
        if (rightItem.when > FIX_ONE_256 * block.number) revert IssuanceNotReady();

        uint256 queueLength = queue.tokens.length;
        uint256[] memory amtDeposits = new uint256[](queueLength);

        // we could dedup this logic but it would take more SLOADS, so this seems best
        if (queue.left == 0) {
            for (uint256 i = 0; i < queueLength; ++i) {
                amtDeposits[i] = rightItem.deposits[i];
            }
            amtRToken = rightItem.amtRToken;
            amtBaskets = rightItem.amtBaskets;
        } else {
            IssueItem storage leftItem = queue.items[queue.left - 1];
            for (uint256 i = 0; i < queueLength; ++i) {
                amtDeposits[i] = rightItem.deposits[i] - leftItem.deposits[i];
            }
            amtRToken = rightItem.amtRToken - leftItem.amtRToken;
            // uint192(-) is safe for Fix.minus()
            amtBaskets = rightItem.amtBaskets - leftItem.amtBaskets;
        }

        _mint(account, amtRToken);
        emit BasketsNeededChanged(basketsNeeded, basketsNeeded + amtBaskets);
        // uint192(+) is safe for Fix.plus()
        basketsNeeded = basketsNeeded + amtBaskets;

        emit Issuance(account, amtRToken, amtBaskets);
        emit IssuancesCompleted(account, queue.left, endId, amtRToken);
        queue.left = endId;

        // == Interactions ==

        for (uint256 i = 0; i < queueLength; ++i) {
            IERC20Upgradeable(queue.tokens[i]).safeTransfer(
                address(main.backingManager()),
                amtDeposits[i]
            );
        }
    }
}
