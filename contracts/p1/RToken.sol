// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

// solhint-disable-next-line max-line-length
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "../interfaces/IMain.sol";
import "../interfaces/IRToken.sol";
import "../libraries/Fixed.sol";
import "../libraries/RedemptionBattery.sol";
import "./mixins/Component.sol";
import "./mixins/RewardableLib.sol";
import "../vendor/ERC20PermitUpgradeable.sol";

// MIN_BLOCK_ISSUANCE_LIMIT: {rTok/block} 10k whole RTok
uint192 constant MIN_BLOCK_ISSUANCE_LIMIT = 10_000 * FIX_ONE;

// MAX_ISSUANCE_RATE: 100%
uint192 constant MAX_ISSUANCE_RATE = FIX_ONE; // {1}

/**
 * @title RTokenP1
 * An ERC20 with an elastic supply and governable exchange rate to basket units.
 */
contract RTokenP1 is ComponentP1, ERC20PermitUpgradeable, IRToken {
    using RedemptionBatteryLib for RedemptionBatteryLib.Battery;
    using SafeERC20Upgradeable for IERC20Upgradeable;

    /// The mandate describes what goals its governors should try to achieve. By succinctly
    /// explaining the RToken’s purpose and what the RToken is intended to do, it provides common
    /// ground for the governors to decide upon priorities and how to weigh tradeoffs.
    ///
    /// Example Mandates:
    ///
    /// - Capital preservation first. Spending power preservation second. Permissionless
    ///     access third.
    /// - Capital preservation above all else. All revenues fund the over-collateralization pool.
    /// - Risk-neutral pursuit of profit for token holders.
    ///     Maximize (gross revenue - payments for over-collateralization and governance).
    /// - This RToken holds only FooCoin, to provide a trade for hedging against its
    ///     possible collapse.
    ///
    /// The mandate may also be a URI to a longer body of text, presumably on IPFS or some other
    /// immutable data store.
    string public mandate;

    // ==== Governance Params ====

    // D18{1} fraction of supply that may be issued per block
    // Always, issuanceRate <= MAX_ISSUANCE_RATE = FIX_ONE
    uint192 public issuanceRate;

    // the following governance parameters exist inside the Battery struct:
    //      battery.redemptionRateFloor
    //      battery.scalingRedemptionRate

    // ==== End Governance Params ====

    // ==== Peer components ====
    IAssetRegistry private assetRegistry;
    IBasketHandler private basketHandler;
    IBackingManager private backingManager;
    IFurnace private furnace;

    // The number of baskets that backingManager must hold
    // in order for this RToken to be fully collateralized.
    // The exchange rate for issuance and redemption is totalSupply()/basketsNeeded {BU}/{qRTok}.
    uint192 public basketsNeeded; // D18{BU}

    // ==== Slow Issuance State====

    // When all pending issuances will have vested.
    uint192 private allVestAt; // D18{fractional block number}

    // Enforce a fixed issuanceRate throughout the entire block by caching it.
    // Both of these MUST only be modified by whenFinished()
    uint192 private lastIssRate; // D18{rTok/block}
    uint256 private lastIssRateBlock; // {block number}

    // IssueItem: One edge of an issuance
    struct IssueItem {
        uint192 when; // D18{fractional block number}
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

    mapping(address => IssueQueue) public issueQueues;

    // Redemption throttle
    RedemptionBatteryLib.Battery private battery;

    // {ERC20: {qTok} owed to Recipients}
    // During reward sweeping, we sweep token balances - liabilities
    mapping(IERC20 => uint256) private liabilities;

    // For an initialized IssueQueue queue:
    //     queue.right >= left
    //     queue.right == left  iff  there are no more pending issuances in this queue
    //
    // The short way to describe this is that IssueQueue stores _cumulative_ issuances, not raw
    // issuances, and so any particular issuance is actually the _difference_ between two adjaacent
    // TotalIssue items in an IssueQueue.
    //
    // The way to keep an IssueQueue striaght in your head is to think of each TotalIssue item as a
    // "fencepost" in the queue of actual issuances. The true issuances are the spans between the
    // TotalIssue items. For example, if:
    //    queue.items[queue.left].amtRToken == 1000 , and
    //    queue.items[queue.right - 1].amtRToken == 6000,
    // then the issuance "between" them is 5000 RTokens. If we waited long enough and then called
    // vest() on that account, we'd vest 5000 RTokens *to* that account.
    //
    // You can vestUpTo an IssueItem queue[i] if
    //   left < i <= right, and
    //   block.number >= queue[i].when.toUint()
    //
    // We define a (partial) ordering on IssueItems: item1 < item2 iff the following all hold:
    //   item1.when < item2.when
    //   item1.amtRToken < item2.amtRToken
    //   item1.amtBaskets < item2.amtBaskets
    //   for all valid indices i, item1.deposits[i] < item2.deposits[i]
    //
    // And, in fact, item2 - item1 is then well-defined (and also piecewise).
    //
    // We'll also define lastItem(addr) as a function of contract state:
    //     if queue.right == 0 then IssueItem.zero else queue.items[queue.right]
    //     where queue = issueQueues[addr]
    //
    // ==== Invariants ====
    // For any queue in value(issueQueues):
    //   if 0 <= i < j <= queue.right, then item[i] < item[j]
    //   queue.items[queue.right] <= allVestAt
    //
    // If queue.left < queue.right, then:
    // - all the issue() calls it models happened while basketHandler.nonce() was queue.basketNonce
    // - queue.tokens = erc20s for each of those issuances, where (erc20s, _) = basket.quote()
    //     so, queue.tokens was the bskt token list when basketHandler.nonce() was queue.basketNonce
    // - for each item in queue.items: queue.tokens.length == item.deposits.length

    function init(
        IMain main_,
        string calldata name_,
        string calldata symbol_,
        string calldata mandate_,
        uint192 issuanceRate_,
        uint192 scalingRedemptionRate_,
        uint256 redemptionRateFloor_
    ) external initializer {
        require(bytes(name_).length > 0, "name empty");
        require(bytes(symbol_).length > 0, "symbol empty");
        require(bytes(mandate_).length > 0, "mandate empty");
        __Component_init(main_);
        __ERC20_init(name_, symbol_);
        __ERC20Permit_init(name_);

        assetRegistry = main_.assetRegistry();
        basketHandler = main_.basketHandler();
        backingManager = main_.backingManager();
        furnace = main_.furnace();

        mandate = mandate_;
        setIssuanceRate(issuanceRate_);
        setScalingRedemptionRate(scalingRedemptionRate_);
        setRedemptionRateFloor(redemptionRateFloor_);
    }

    /// Begin a time-delayed issuance of RToken for basket collateral
    /// @param amtRToken {qTok} The quantity of RToken to issue
    /// @custom:interaction nearly CEI, but see comments around handling of refunds
    function issue(uint256 amtRToken) external {
        issue(_msgSender(), amtRToken);
    }

    /// Begin a time-delayed issuance of RToken for basket collateral
    /// @param recipient The address to receive the issued RTokens
    /// @param amtRToken {qTok} The quantity of RToken to issue
    /// @return mintedAmount {qTok} The amount of RTokens minted (instantly issued)
    /// @custom:interaction nearly CEI, but see comments around handling of refunds
    function issue(address recipient, uint256 amtRToken)
        public
        notPausedOrFrozen
        returns (uint256)
    {
        require(amtRToken > 0, "Cannot issue zero");

        // == Refresh ==
        assetRegistry.refresh();

        address issuer = _msgSender(); // OK to save: it can't be changed in reentrant runs

        uint48 basketNonce = basketHandler.nonce();
        IssueQueue storage queue = issueQueues[recipient];

        // Refund issuances against old baskets
        if (queue.basketNonce > 0 && queue.basketNonce != basketNonce) {
            // == Interaction ==
            // This violates simple CEI, so we have to renew any potential transient state!
            refundSpan(recipient, queue.left, queue.right);

            // Refresh collateral after interaction
            assetRegistry.refresh();

            // Refresh local values after potential reentrant changes to contract state.
            basketNonce = basketHandler.nonce();
            queue = issueQueues[recipient];
        }

        // == Checks-effects block ==
        CollateralStatus status = basketHandler.status();
        require(status == CollateralStatus.SOUND, "basket unsound");

        furnace.melt();

        // AT THIS POINT:
        //   all contract invariants hold
        //   furnace melting is up-to-date
        //   asset states are up-to-date
        //   queue.basketNonce = basketHandler.nonce()

        // Compute the whole issuance span. We want to accumulate the issuance:
        // iss = {when: vestingEnd' - vestingEnd, amtRToken, amtBaskets, deposits}

        // amtBaskets: the BU change to be recorded by this issuance
        // D18{BU} = D18{BU} * {qRTok} / {qRTok}
        // Downcast is safe because an actual quantity of qBUs fits in uint192
        uint192 amtBaskets = uint192(
            totalSupply() > 0 ? mulDiv256(basketsNeeded, amtRToken, totalSupply()) : amtRToken
        );

        (address[] memory erc20s, uint256[] memory deposits) = basketHandler.quote(
            amtBaskets,
            CEIL
        );

        // Add amtRToken's worth of issuance delay to allVestAt
        uint192 vestingEnd = whenFinished(amtRToken); // D18{block number}

        // ==== If the issuance can fit in this block, and nothing is blocking it, then
        // just do a "quick issuance" of iss instead of putting the issuance in the queue:
        // effects and actions if we go this way are the combined actions to create and vest iss:
        //   basketsNeeded += iss.amtBaskets
        //   mint(recipient, iss.amtRToken)
        //   for each token index i, erc20s[i].transferFrom(issuer, backingManager, iss.deposits[i])
        if (
            // D18{blocks} <= D18{1} * {blocks}
            vestingEnd <= FIX_ONE_256 * block.number &&
            queue.left == queue.right &&
            status == CollateralStatus.SOUND
        ) {
            // Fixlib optimization:
            // D18{BU} = D18{BU} + D18{BU}; uint192(+) is the same as Fix.plus
            uint192 newBasketsNeeded = basketsNeeded + amtBaskets;
            emit BasketsNeededChanged(basketsNeeded, newBasketsNeeded);
            basketsNeeded = newBasketsNeeded;

            // Note: We don't need to update the prev queue entry because queue.left = queue.right
            emit Issuance(recipient, amtRToken, amtBaskets);

            // == Interactions then return: transfer tokens ==
            // Complete issuance
            _mint(recipient, amtRToken);

            for (uint256 i = 0; i < erc20s.length; ++i) {
                IERC20Upgradeable(erc20s[i]).safeTransferFrom(
                    issuer,
                    address(backingManager),
                    deposits[i]
                );
            }

            // All RTokens instantly issued
            return amtRToken;
        }

        // ==== Otherwise, we're going to create and enqueue the issuance "iss":
        // effects and actions down this route are:
        //   lastItem'(recipient) = lastItem(recipient) + iss
        //   for each token index i, erc20s[i].transferFrom(issuer, this, iss.deposits[i])
        // Append issuance to queue (whether that needs a new allocation with push() or not)
        IssueItem storage curr = (queue.right < queue.items.length)
            ? queue.items[queue.right]
            : queue.items.push();
        curr.when = vestingEnd;

        uint256 basketSize = erc20s.length; // gas optimization

        // Accumulate
        if (queue.right > 0) {
            IssueItem storage prev = queue.items[queue.right - 1];
            curr.amtRToken = prev.amtRToken + amtRToken;

            // D18{BU} = D18{BU} + D18{BU}; uint192(+) is the same as Fix.plus
            curr.amtBaskets = prev.amtBaskets + amtBaskets;

            curr.deposits = new uint256[](deposits.length);
            for (uint256 i = 0; i < basketSize; ++i) {
                curr.deposits[i] = prev.deposits[i] + deposits[i];
            }
        } else {
            // queue.right == 0
            curr.amtRToken = amtRToken;
            curr.amtBaskets = amtBaskets;
            curr.deposits = deposits;
        }

        // overwrite intentionally: we may have stale values in `tokens` and `basketNonce`
        queue.basketNonce = basketNonce;
        queue.tokens = erc20s;
        queue.right++;

        emit IssuanceStarted(
            recipient,
            queue.right - 1,
            amtRToken,
            amtBaskets,
            erc20s,
            deposits,
            vestingEnd
        );

        // Increment liabilities
        for (uint256 i = 0; i < basketSize; ++i) {
            liabilities[IERC20(erc20s[i])] += deposits[i];
        }

        // == Interactions: accept collateral ==
        for (uint256 i = 0; i < basketSize; ++i) {
            IERC20Upgradeable(erc20s[i]).safeTransferFrom(issuer, address(this), deposits[i]);
        }

        // No RTokens instantly issued
        return 0;
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

        // make `before` be the fractional-block when this issuance should start;
        // before = max(allVestAt, block.number - 1)
        uint192 before = allVestAt; // D18{block number}
        // uint192 downcast is safe: block numbers are smaller than 1e38
        uint192 nowStart = uint192(FIX_ONE * (block.number - 1)); // D18{block} = D18{1} * {block}
        if (nowStart > before) before = nowStart;

        // finished: D18{block} = D18{block} + D18{1} * D18{RTok} / D18{rtok/block}
        // uint192() downcast here is safe because:
        //   lastIssRate is at least 1e24 (from MIN_ISS_RATE), and
        //   amtRToken is at most 1e48, so
        //   what's downcast is at most (1e18 * 1e48 / 1e24) = 1e38 < 2^192-1
        finished = before + uint192((FIX_ONE_256 * amtRToken + (lastIssRate - 1)) / lastIssRate);
        allVestAt = finished;
    }

    /// Vest all available issuance for the account
    /// Callable by anyone!
    /// @param account The address of the account to vest issuances for
    /// @custom:completion
    /// @custom:interaction CEI
    // Thin wrapper over refundSpan() and vestUpTo(); see those for correctness analysis
    function vest(address account, uint256 endId) external notPausedOrFrozen {
        // == Keepers ==
        main.assetRegistry().refresh();

        // == Checks ==
        CollateralStatus status = basketHandler.status();
        require(status == CollateralStatus.SOUND, "basket unsound");

        IssueQueue storage queue = issueQueues[account];
        uint48 basketNonce = basketHandler.nonce();

        // == Interactions ==
        // ensure that the queue models issuances against the current basket, not previous baskets;
        // refund all old issuances if there are any
        if (queue.basketNonce != basketNonce) {
            refundSpan(account, queue.left, queue.right);
        } else {
            vestUpTo(account, endId);
        }
    }

    /// Cancel some vesting issuance(s)
    /// Only callable by the account owner
    /// If earliest == true, cancel id if id < endId
    /// If earliest == false, cancel id if endId <= id
    /// @param endId The issuance index to cancel through
    /// @param earliest If true, cancel earliest issuances; else, cancel latest issuances
    /// @custom:interaction CEI
    function cancel(uint256 endId, bool earliest) external notFrozen {
        address account = _msgSender();
        IssueQueue storage queue = issueQueues[account];

        require(queue.left <= endId && endId <= queue.right, "out of range");

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
    // checks:
    //   balanceOf(caller) >= amount
    //   basket is not DISABLED
    //
    // effects:
    //   (so totalSupply -= amount and balanceOf(caller) -= amount)
    //   basketsNeeded' / totalSupply' >== basketsNeeded / totalSupply
    //
    // actions:
    //   let erc20s = basketHandler.erc20s()
    //   burn(caller, amount)
    //   for each token in erc20s:
    //     let tokenAmt = (amount * basketsNeeded / totalSupply) baskets of support for token
    //     let prorataAmt = (amount / totalSupply) * token.balanceOf(backingManager)
    //     do token.transferFrom(backingManager, caller, min(tokenAmt, prorataAmt))
    function redeem(uint256 amount) external notFrozen {
        require(amount > 0, "Cannot redeem zero");

        // == Refresh ==
        main.assetRegistry().refresh();

        // == Checks and Effects ==
        address redeemer = _msgSender();
        // Allow redemption during IFFY + UNPRICED
        require(basketHandler.status() != CollateralStatus.DISABLED, "collateral default");

        // Failure to melt results in a lower redemption price, so we can allow it when paused
        // solhint-disable-next-line no-empty-blocks
        try main.furnace().melt() {} catch {}

        uint192 basketsNeeded_ = basketsNeeded; // gas optimization

        // ==== Get basket redemption ====
        // i.e, set (erc20s, amounts) = basketHandler.quote(amount * basketsNeeded / totalSupply)

        // D18{BU} = D18{BU} * {qRTok} / {qRTok}
        // downcast is safe: amount < totalSupply and basketsNeeded_ < 1e57 < 2^190 (just barely)
        uint256 supply = totalSupply();
        uint192 baskets = uint192(mulDiv256(basketsNeeded_, amount, supply));
        emit Redemption(redeemer, amount, baskets);

        (address[] memory erc20s, uint256[] memory amounts) = basketHandler.quote(baskets, FLOOR);

        // ==== Prorate redemption ====
        // i.e, set amounts = min(amounts, balances * amount / totalSupply)
        //   where balances[i] = erc20s[i].balanceOf(this)

        uint256 erc20length = erc20s.length;

        // D18{1} = D18 * {qRTok} / {qRTok}
        // downcast is safe: amount <= balanceOf(redeemer) <= totalSupply(), so prorate < 1e18
        uint192 prorate = uint192((FIX_ONE_256 * amount) / supply);

        // Bound each withdrawal by the prorata share, in case we're currently under-collateralized
        for (uint256 i = 0; i < erc20length; ++i) {
            // {qTok}
            uint256 bal = IERC20Upgradeable(erc20s[i]).balanceOf(address(backingManager));

            // gas-optimization: only do the full mulDiv256 if prorate is 0
            uint256 prorata = (prorate > 0)
                ? (prorate * bal) / FIX_ONE // {qTok} = D18{1} * {qTok} / D18
                : mulDiv256(bal, amount, supply); // {qTok} = {qTok} * {qRTok} / {qRTok}

            if (prorata < amounts[i]) amounts[i] = prorata;
        }

        // Revert if redemption exceeds battery capacity
        battery.discharge(supply, amount); // reverts on over-redemption

        basketsNeeded = basketsNeeded_ - baskets;
        emit BasketsNeededChanged(basketsNeeded_, basketsNeeded);

        // == Interactions ==
        // Accept and burn RToken, reverts if not enough balance to burn
        _burn(redeemer, amount);

        bool allZero = true;
        for (uint256 i = 0; i < erc20length; ++i) {
            if (amounts[i] == 0) continue;
            if (allZero) allZero = false;

            // Send withdrawal
            IERC20Upgradeable(erc20s[i]).safeTransferFrom(
                address(backingManager),
                redeemer,
                amounts[i]
            );
        }

        if (allZero) revert("Empty redemption");
    }

    // === Rewards ===

    /// Claim rewards for all ERC20s
    /// @custom:interaction
    function claimRewards() external {
        requireNotPausedOrFrozen();
        RewardableLibP1.claimRewards(assetRegistry);
    }

    /// Claim rewards for one ERC20
    /// @custom:interaction
    function claimRewardsSingle(IERC20 erc20) external {
        requireNotPausedOrFrozen();
        RewardableLibP1.claimRewardsSingle(assetRegistry.toAsset(erc20));
    }

    /// Sweep all token balances in excess of liabilities to the BackingManager
    /// @custom:interaction
    function sweepRewards() external {
        requireNotPausedOrFrozen();
        RewardableLibP1.sweepRewards(liabilities, assetRegistry, backingManager);
    }

    /// Sweep an ERC20's rewards in excess of liabilities to the BackingManager
    /// @custom:interaction
    function sweepRewardsSingle(IERC20 erc20) external {
        requireNotPausedOrFrozen();
        RewardableLibP1.sweepRewardsSingle(liabilities, erc20, assetRegistry, backingManager);
    }

    // ====

    /// Mint a quantity of RToken to the `recipient`, decreasing the basket rate
    /// @param recipient The recipient of the newly minted RToken
    /// @param amtRToken {qRTok} The amtRToken to be minted
    /// @custom:protected
    // checks: unpaused; unfrozen; caller is backingManager
    // effects:
    //   bal'[recipient] = bal[recipient] + amtRToken
    //   totalSupply' = totalSupply + amtRToken
    function mint(address recipient, uint256 amtRToken) external {
        requireNotPausedOrFrozen();
        require(_msgSender() == address(backingManager), "not backing manager");
        _mint(recipient, amtRToken);
        requireValidBUExchangeRate();
    }

    /// Melt a quantity of RToken from the caller's account, increasing the basket rate
    /// @param amtRToken {qRTok} The amtRToken to be melted
    // checks: not paused or frozen
    // effects:
    //   bal'[caller] = bal[caller] - amtRToken
    //   totalSupply' = totalSupply - amtRToken
    function melt(uint256 amtRToken) external notPausedOrFrozen {
        _burn(_msgSender(), amtRToken);
        emit Melted(amtRToken);
        requireValidBUExchangeRate();
    }

    /// An affordance of last resort for Main in order to ensure re-capitalization
    /// @custom:protected
    // checks: unpaused; unfrozen; caller is backingManager
    // effects: basketsNeeded' = basketsNeeded_
    function setBasketsNeeded(uint192 basketsNeeded_) external {
        requireNotPausedOrFrozen();
        require(_msgSender() == address(backingManager), "not backing manager");
        emit BasketsNeededChanged(basketsNeeded, basketsNeeded_);
        basketsNeeded = basketsNeeded_;
        requireValidBUExchangeRate();
    }

    /// @param val {1/block}
    /// @custom:governance
    function setIssuanceRate(uint192 val) public governance {
        require(val > 0 && val <= MAX_ISSUANCE_RATE, "invalid issuanceRate");
        emit IssuanceRateSet(issuanceRate, val);
        issuanceRate = val;
    }

    /// @return {1/hour} The max redemption charging rate
    function scalingRedemptionRate() external view returns (uint192) {
        return battery.scalingRedemptionRate;
    }

    /// @param val {1/hour}
    /// @custom:governance
    function setScalingRedemptionRate(uint192 val) public governance {
        require(val <= FIX_ONE, "invalid fraction");
        emit ScalingRedemptionRateSet(battery.scalingRedemptionRate, val);
        battery.scalingRedemptionRate = val;
    }

    /// @return {qRTok/hour} The min redemption charging rate, in {qRTok}
    function redemptionRateFloor() external view returns (uint256) {
        return battery.redemptionRateFloor;
    }

    /// @param val {qRTok/hour}
    /// @custom:governance
    function setRedemptionRateFloor(uint256 val) public governance {
        emit RedemptionRateFloorSet(battery.redemptionRateFloor, val);
        battery.redemptionRateFloor = val;
    }

    /// @dev This function is only here because solidity can't autogenerate our getter
    function issueItem(address account, uint256 index) external view returns (IssueItem memory) {
        IssueQueue storage item = issueQueues[account];
        require(index >= item.left && index < item.right, "out of range");
        return item.items[index];
    }

    /// @return {qRTok} The maximum redemption that can be performed in the current block
    function redemptionLimit() external view returns (uint256) {
        return battery.currentCharge(totalSupply());
    }

    /// @return left The index of the left sides of the issuance queue for the account
    /// @return right The index of the right sides of the issuance queue for the account
    function queueBounds(address account) external view returns (uint256 left, uint256 right) {
        return (issueQueues[account].left, issueQueues[account].right);
    }

    // ==== private ====
    /// Refund all deposits in the span [left, right)
    /// @custom:interaction

    // Precisely: if right > left, then:
    //
    //   let iss = item(right) - item(left)
    //     where item(0) = the zero item
    //         | item(n) = issueQueues[account].items[n-1]
    //
    //   (effect) ELIMINATE ISSUANCE SPAN: Set queue.left and queue.right so that:
    //     [queue'.left, queue'.right) intersect [left, right) == empty set
    //     [queue'.left, queue'.right) union [left, right) == [queue.left, queue.right)
    //     If [queue'.left, queue'.right) == empty set, then queue'.left == queue'.right == 0
    //
    //   (action) REFUND DEPOSITS: For i in [0, iss.deposits.length):
    //     issueQueues[account].erc20s[i].transfer(account, iss.deposits[i])
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

        // compute item(right-1) - item(left-1)
        // we could dedup this logic for the zero item, but it would take more SLOADS
        if (left == 0) {
            amtRToken = rightItem.amtRToken;
            for (uint256 i = 0; i < tokensLen; ++i) {
                amt[i] = rightItem.deposits[i];

                // Decrement liabilities
                liabilities[IERC20(queue.tokens[i])] -= amt[i];
            }
        } else {
            IssueItem storage leftItem = queue.items[left - 1];
            amtRToken = rightItem.amtRToken - leftItem.amtRToken;
            for (uint256 i = 0; i < tokensLen; ++i) {
                amt[i] = rightItem.deposits[i] - leftItem.deposits[i];

                // Decrement liabilities
                liabilities[IERC20(queue.tokens[i])] -= amt[i];
            }
        }

        if (queue.left == left && right == queue.right) {
            // empty entire queue
            queue.left = 0;
            queue.right = 0;
        } else if (queue.left == left && right < queue.right) {
            queue.left = right; // remove span from beginning
        } else if (queue.left < left && right == queue.right) {
            queue.right = left; // refund span from end
        } else {
            // untestable:
            //      All calls to refundSpan() use valid values for left and right.
            //      queue.left <= left && right <= queue.right.
            //      Any call to refundSpan() passes queue.left for left,
            //      OR passes queue.right for right, OR both.
            revert("Bad refundSpan");
        } // error: can't remove [left,right) from the queue, and leave just one interval

        emit IssuancesCanceled(account, left, right, amtRToken);

        // == Interactions ==
        for (uint256 i = 0; i < queue.tokens.length; ++i) {
            IERC20Upgradeable(queue.tokens[i]).safeTransfer(account, amt[i]);
        }
    }

    /// Vest all RToken issuance in queue = queues[account], from queue.left to < endId
    /// Fixes up queue.left and queue.right
    /// @custom:interaction
    // let iss = item(endId) - item(queue.left)
    //     where item(0) = the zero item
    //         | item(n) = issueQueues[account].items[n-1]
    //
    // checks:
    //   queue.left <= endId <= queue.right
    //   item(endId).when <= block.number + 1
    //
    //
    //   (effect) ELIMINATE ISSUANCE SPAN: Set queue.left so that:
    //     [queue'.left, queue'.right) intersect [queue.left, endId) == empty set
    //     [queue'.left, queue'.right) union [queue.left, endId) == [queue.left, queue.right)
    //     If [queue'.left, queue'.right) == empty set, then queue'.left == queue'.right == 0
    //
    //   (effect + action) COMPLETE ISSUANCE of iss:
    //     for i in [0, iss.deposits.length):
    //       issueQueues[account].erc20s[i].transfer(backingManager, iss.deposits[i]
    //     _mint(account, iss.amtRToken)
    function vestUpTo(address account, uint256 endId) private {
        IssueQueue storage queue = issueQueues[account];
        if (queue.left == endId) return;

        require(queue.left <= endId && endId <= queue.right, "out of range");

        // Vest the span up to `endId`.
        uint256 amtRToken;
        uint192 amtBaskets;
        IssueItem storage rightItem = queue.items[endId - 1];
        require(rightItem.when <= FIX_ONE_256 * block.number, "issuance not ready");

        uint256 tokensLen = queue.tokens.length;
        uint256[] memory amtDeposits = new uint256[](tokensLen);

        // compute item(right - 1) - item(left - 1)
        // we could dedup this logic for the zero item, but it would take more SLOADS
        if (queue.left == 0) {
            amtRToken = rightItem.amtRToken;
            amtBaskets = rightItem.amtBaskets;
            for (uint256 i = 0; i < tokensLen; ++i) {
                amtDeposits[i] = rightItem.deposits[i];

                // Decrement liabilities
                liabilities[IERC20(queue.tokens[i])] -= amtDeposits[i];
            }
        } else {
            IssueItem storage leftItem = queue.items[queue.left - 1];
            amtRToken = rightItem.amtRToken - leftItem.amtRToken;
            amtBaskets = rightItem.amtBaskets - leftItem.amtBaskets;
            for (uint256 i = 0; i < tokensLen; ++i) {
                amtDeposits[i] = rightItem.deposits[i] - leftItem.deposits[i];

                // Decrement liabilities
                liabilities[IERC20(queue.tokens[i])] -= amtDeposits[i];
            }
        }

        emit BasketsNeededChanged(basketsNeeded, basketsNeeded + amtBaskets);
        // uint192(+) is safe for Fix.plus()
        basketsNeeded = basketsNeeded + amtBaskets;

        emit Issuance(account, amtRToken, amtBaskets);
        emit IssuancesCompleted(account, queue.left, endId, amtRToken);

        if (endId == queue.right) {
            // empty the queue - left is implicitly queue.left already
            queue.left = 0;
            queue.right = 0;
        } else {
            queue.left = endId;
        }

        // == Interactions ==
        _mint(account, amtRToken);

        for (uint256 i = 0; i < tokensLen; ++i) {
            IERC20Upgradeable(queue.tokens[i]).safeTransfer(
                address(backingManager),
                amtDeposits[i]
            );
        }
    }

    /// Require the BU to RToken exchange rate to be in [1e-9, 1e9]
    function requireValidBUExchangeRate() private view {
        uint256 supply = totalSupply();
        if (supply == 0) return;

        // Note: These are D18s, even though they are uint256s. This is because
        // we cannot assume we stay inside our valid range here, as that is what
        // we are checking in the first place
        uint256 low = (FIX_ONE_256 * basketsNeeded) / supply; // D18{BU/rTok}
        uint256 high = (FIX_ONE_256 * basketsNeeded + (supply - 1)) / supply; // D18{BU/rTok}

        // 1e9 = FIX_ONE / 1e9; 1e27 = FIX_ONE * 1e9
        require(uint192(low) >= 1e9 && uint192(high) <= 1e27, "BU rate out of range");
    }

    /**
     * @dev Hook that is called before any transfer of tokens. This includes
     * minting and burning.
     *
     * Calling conditions:
     *
     * - when `from` and `to` are both non-zero, `amount` of ``from``'s tokens
     * will be transferred to `to`.
     * - when `from` is zero, `amount` tokens will be minted for `to`.
     * - when `to` is zero, `amount` of ``from``'s tokens will be burned.
     * - `from` and `to` are never both zero.
     */
    function _beforeTokenTransfer(
        address,
        address to,
        uint256
    ) internal virtual override {
        require(to != address(this), "RToken transfer to self");
    }

    /// @dev Used in reward claim functions to save on contract size
    // solhint-disable-next-line no-empty-blocks
    function requireNotPausedOrFrozen() private notPausedOrFrozen {}

    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
     */
    uint256[37] private __gap;
}
