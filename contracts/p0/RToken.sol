// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

// solhint-disable-next-line max-line-length
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "contracts/interfaces/IMain.sol";
import "contracts/interfaces/IBasketHandler.sol";
import "contracts/interfaces/IRToken.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/libraries/RedemptionBattery.sol";
import "contracts/p0/mixins/Component.sol";
import "contracts/p0/mixins/Rewardable.sol";
import "contracts/vendor/ERC20PermitUpgradeable.sol";

struct SlowIssuance {
    address issuer;
    uint256 amount; // {qRTok}
    uint192 baskets; // {BU}
    address[] erc20s;
    uint256[] deposits;
    uint256 basketNonce;
    uint192 blockAvailableAt; // {block.number} fractional
    bool processed;
}

/**
 * @title RTokenP0
 * @notice An ERC20 with an elastic supply and governable exchange rate to basket units.
 */
contract RTokenP0 is ComponentP0, RewardableP0, ERC20PermitUpgradeable, IRToken {
    using EnumerableSet for EnumerableSet.AddressSet;
    using FixLib for uint192;
    using RedemptionBatteryLib for RedemptionBatteryLib.Battery;
    using SafeERC20 for IERC20;

    /// Weakly immutable: expected to be an IPFS link but could be the mandate itself
    string public mandate;

    // To enforce a fixed issuanceRate throughout the entire block
    mapping(uint256 => uint256) private blockIssuanceRates; // block.number => {qRTok/block}

    // MIN_BLOCK_ISSUANCE_LIMIT: {qRTok/block} 10k whole RTok
    uint256 public constant MIN_BLOCK_ISSUANCE_LIMIT = 10_000 * FIX_ONE;

    // MAX_ISSUANCE_RATE
    uint192 public constant MAX_ISSUANCE_RATE = 1e18; // {%}

    // List of accounts. If issuances[user].length > 0 then (user is in accounts)
    EnumerableSet.AddressSet internal accounts;

    mapping(address => SlowIssuance[]) public issuances;

    // When all pending issuances will have vested.
    // This is fractional so that we can represent partial progress through a block.
    uint192 public allVestAt; // {fractional block number}

    uint192 public basketsNeeded; //  {BU}

    uint192 public issuanceRate; // {1/block} of RToken supply to issue per block

    // === Redemption battery ===

    RedemptionBatteryLib.Battery private battery;

    // === Liability Tracking ===

    // {ERC20: {qTok} owed to Issuers}
    mapping(IERC20 => uint256) private liabilities;

    // === For P1 compatibility in testing ===

    // IssueItem: One edge of an issuance
    struct IssueItem {
        uint192 when; // D18{fractional block number}
        uint256 amtRToken; // {qRTok} Total amount of RTokens that have vested by `when`
        uint192 amtBaskets; // D18{BU} Total amount of baskets that should back those RTokens
        uint256[] deposits; // {qTok}, Total amounts of basket collateral deposited for vesting
    }

    // ===

    function init(
        IMain main_,
        string memory name_,
        string memory symbol_,
        string calldata mandate_,
        uint192 issuanceRate_,
        uint192 scalingRedemptionRate_,
        uint256 redemptionRateFloor_
    ) public initializer {
        require(bytes(name_).length > 0, "name empty");
        require(bytes(symbol_).length > 0, "symbol empty");
        require(bytes(mandate_).length > 0, "mandate empty");
        __Component_init(main_);
        __ERC20_init(name_, symbol_);
        __ERC20Permit_init(name_);

        mandate = mandate_;
        setIssuanceRate(issuanceRate_);
        setScalingRedemptionRate(scalingRedemptionRate_);
        setRedemptionRateFloor(redemptionRateFloor_);
    }

    function setIssuanceRate(uint192 val) public governance {
        require(val > 0 && val <= MAX_ISSUANCE_RATE, "invalid issuanceRate");
        emit IssuanceRateSet(issuanceRate, val);
        issuanceRate = val;
    }

    /// @return {1/hour} The max redemption charging rate
    function scalingRedemptionRate() external view returns (uint192) {
        return battery.scalingRedemptionRate;
    }

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

    /// @custom:governance
    function setRedemptionRateFloor(uint256 val) public governance {
        emit RedemptionRateFloorSet(battery.redemptionRateFloor, val);
        battery.redemptionRateFloor = val;
    }

    /// Begin a time-delayed issuance of RToken for basket collateral
    /// @param amount {qTok} The quantity of RToken to issue
    /// @custom:interaction
    function issue(uint256 amount) external notPausedOrFrozen {
        require(amount > 0, "Cannot issue zero");
        // Call collective state keepers.
        main.poke();

        IBasketHandler basketHandler = main.basketHandler();
        require(basketHandler.status() == CollateralStatus.SOUND, "basket unsound");

        address issuer = _msgSender();
        refundAndClearStaleIssuances(issuer);

        // Compute # of baskets to create `amount` qRTok
        uint192 baskets = (totalSupply() > 0) // {BU}
            ? basketsNeeded.muluDivu(amount, totalSupply()) // {BU * qRTok / qRTok}
            : shiftl_toFix(amount, -int8(decimals())); // {qRTok / qRTok}

        (address[] memory erc20s, uint256[] memory deposits) = basketHandler.quote(baskets, CEIL);
        // Accept collateral
        for (uint256 i = 0; i < erc20s.length; i++) {
            liabilities[IERC20(erc20s[i])] += deposits[i];
            IERC20(erc20s[i]).safeTransferFrom(issuer, address(this), deposits[i]);
        }

        // Add a new SlowIssuance ticket to the queue
        uint48 basketNonce = main.basketHandler().nonce();
        SlowIssuance memory iss = SlowIssuance({
            issuer: issuer,
            amount: amount,
            baskets: baskets,
            erc20s: erc20s,
            deposits: deposits,
            basketNonce: basketNonce,
            blockAvailableAt: nextIssuanceBlockAvailable(amount),
            processed: false
        });
        issuances[issuer].push(iss);
        accounts.add(issuer);

        uint256 index = issuances[issuer].length - 1;
        emit IssuanceStarted(
            iss.issuer,
            index,
            iss.amount,
            iss.baskets,
            iss.erc20s,
            iss.deposits,
            iss.blockAvailableAt
        );

        // Complete issuance instantly if it fits into this block and basket is sound
        if (
            iss.blockAvailableAt.lte(toFix(block.number)) &&
            basketHandler.status() == CollateralStatus.SOUND
        ) {
            // At this point all checks have been done to ensure the issuance should vest
            uint256 vestedAmount = tryVestIssuance(issuer, index);
            emit IssuancesCompleted(issuer, index, index, vestedAmount);
            assert(vestedAmount == iss.amount);
            // Remove issuance
            issuances[issuer].pop();
        }
    }

    /// Cancels a vesting slow issuance
    /// @custom:interaction
    /// If earliest == true, cancel id if id < endId
    /// If earliest == false, cancel id if endId <= id
    /// @param endId One end of the range of issuance IDs to cancel
    /// @param earliest If true, cancel earliest issuances; else, cancel latest issuances
    /// @custom:interaction
    function cancel(uint256 endId, bool earliest) external notFrozen {
        // Call collective state keepers.
        // notFrozen modifier requires we use only a subset of main.poke()
        main.assetRegistry().refresh();

        // solhint-disable-next-line no-empty-blocks
        try main.furnace().melt() {} catch {}

        address account = _msgSender();

        require(leftIndex(account) <= endId && endId <= rightIndex(account), "out of range");

        SlowIssuance[] storage queue = issuances[account];

        uint256 amtRToken; // {qRTok}
        uint256 numCanceled;
        uint256 left;
        (uint256 first, uint256 last) = earliest ? (0, endId) : (endId, queue.length);

        // Refund issuances that have not yet been processed
        for (uint256 n = first; n < last && n < queue.length; n++) {
            SlowIssuance storage iss = queue[n];
            if (!iss.processed) {
                for (uint256 i = 0; i < iss.erc20s.length; i++) {
                    liabilities[IERC20(iss.erc20s[i])] -= iss.deposits[i];
                    IERC20(iss.erc20s[i]).safeTransfer(iss.issuer, iss.deposits[i]);
                }
                amtRToken += iss.amount;
                iss.processed = true;
                numCanceled++;

                if (numCanceled == 1) left = n;
            }
        }

        if (numCanceled > 0) emit IssuancesCanceled(account, left, last, amtRToken);

        // Empty queue from right
        for (int256 i = int256(queue.length) - 1; i >= 0; i--) {
            if (!queue[uint256(i)].processed) break;
            queue.pop();
        }
    }

    /// Completes all vested slow issuances for the account, callable by anyone
    /// @param account The address of the account to vest issuances for
    /// @custom:interaction
    function vest(address account, uint256 endId) external notPausedOrFrozen {
        // Call collective state keepers.
        main.poke();

        require(main.basketHandler().status() == CollateralStatus.SOUND, "basket unsound");

        // Perform range validations - P1 compatibility
        if (leftIndex(account) == endId) return;
        require(leftIndex(account) <= endId && endId <= rightIndex(account), "out of range");

        // Only continue with vesting if basket did not change - P1 compatibility
        bool someProcessed = refundAndClearStaleIssuances(account);
        if (someProcessed) return;

        SlowIssuance[] storage queue = issuances[account];
        uint256 first;
        uint256 totalVested;
        for (uint256 i = 0; i < endId && i < queue.length; i++) {
            uint256 vestedAmount = tryVestIssuance(account, i);
            totalVested += vestedAmount;
            if (first == 0 && vestedAmount > 0) first = i;
        }
        if (totalVested > 0) emit IssuancesCompleted(account, first, endId, totalVested);

        // Empty queue if no ongoing issuances
        if (endId == queue.length) {
            for (int256 i = int256(queue.length) - 1; i >= 0; i--) {
                assert(queue[uint256(i)].processed);
                queue.pop();
            }
        }
    }

    /// Return the highest index that could be completed by a vestIssuances call.
    /// In P1 this function is over in the Facade
    function endIdForVest(address account) external view returns (uint256) {
        uint256 i = leftIndex(account);
        uint192 currBlock = toFix(block.number);
        SlowIssuance[] storage queue = issuances[account];

        while (i < queue.length && queue[i].blockAvailableAt.lte(currBlock)) i++;
        return i;
    }

    /// Redeem RToken for basket collateral
    /// @param amount {qTok} The quantity {qRToken} of RToken to redeem
    /// @custom:interaction
    function redeem(uint256 amount) external notFrozen {
        require(amount > 0, "Cannot redeem zero");
        require(balanceOf(_msgSender()) >= amount, "not enough RToken");

        // Call collective state keepers.
        // notFrozen modifier requires we use only a subset of main.poke()
        main.assetRegistry().refresh();

        // Failure to melt results in a lower redemption price, so we can allow it when paused
        // solhint-disable-next-line no-empty-blocks
        try main.furnace().melt() {} catch {}

        IBasketHandler basketHandler = main.basketHandler();
        require(basketHandler.status() != CollateralStatus.DISABLED, "collateral default");

        // {BU} = {BU} * {qRTok} / {qRTok}
        uint192 baskets = basketsNeeded.muluDivu(amount, totalSupply());
        assert(baskets.lte(basketsNeeded));
        emit Redemption(_msgSender(), amount, baskets);

        (address[] memory erc20s, uint256[] memory amounts) = basketHandler.quote(baskets, FLOOR);

        // {1} = {qRTok} / {qRTok}
        uint192 prorate = toFix(amount).divu(totalSupply());

        // Revert if redemption exceeds battery capacity
        battery.discharge(totalSupply(), amount); // reverts on over-redemption

        // Accept and burn RToken
        _burn(_msgSender(), amount);

        emit BasketsNeededChanged(basketsNeeded, basketsNeeded.minus(baskets));
        basketsNeeded = basketsNeeded.minus(baskets);

        // ==== Send back collateral tokens ====
        IBackingManager backingMgr = main.backingManager();

        bool allZero = true;
        for (uint256 i = 0; i < erc20s.length; i++) {
            // Bound each withdrawal by the prorata share, in case we're currently under-capitalized
            uint256 bal = IERC20(erc20s[i]).balanceOf(address(backingMgr));
            // {qTok} = {1} * {qTok}
            uint256 prorata = prorate.mulu_toUint(bal);
            amounts[i] = Math.min(amounts[i], prorata);
            // Send withdrawal
            if (amounts[i] > 0) {
                IERC20(erc20s[i]).safeTransferFrom(address(backingMgr), _msgSender(), amounts[i]);
                if (allZero) allZero = false;
            }
        }

        if (allZero) revert("Empty redemption");
    }

    // === Rewards ===

    /// Sweep all reward tokens in excess of liabilities to the BackingManager
    /// @custom:interaction
    function sweepRewards() external notPausedOrFrozen {
        IERC20[] memory erc20s = main.assetRegistry().erc20s();
        IBackingManager bm = main.backingManager();

        // Sweep deltas
        for (uint256 i = 0; i < erc20s.length; ++i) {
            uint256 delta = erc20s[i].balanceOf(address(this)) - liabilities[erc20s[i]]; // {qTok}
            if (delta > 0) IERC20(address(erc20s[i])).safeTransfer(address(bm), delta);
        }
    }

    /// Sweep an ERC20's rewards in excess of liabilities to the BackingManager
    /// @custom:interaction
    function sweepRewardsSingle(IERC20 erc20) external notPausedOrFrozen {
        uint256 amt = erc20.balanceOf(address(this)) - liabilities[erc20];
        if (amt > 0) {
            erc20.safeTransfer(address(main.backingManager()), amt);

            // Verify nothing has gone wrong
            assert(erc20.balanceOf(address(this)) >= liabilities[erc20]);
        }
    }

    // ===

    /// Mint a quantity of RToken to the `recipient`, decreasing the basket rate
    /// @param recipient The recipient of the newly minted RToken
    /// @param amount {qRTok} The amount to be minted
    /// @custom:protected
    function mint(address recipient, uint256 amount) external notPausedOrFrozen {
        require(_msgSender() == address(main.backingManager()), "not backing manager");
        _mint(recipient, amount);
        requireValidBUExchangeRate();
    }

    /// Melt a quantity of RToken from the caller's account, increasing the basket rate
    /// @param amount {qRTok} The amount to be melted
    function melt(uint256 amount) external notPausedOrFrozen {
        _burn(_msgSender(), amount);
        emit Melted(amount);
        requireValidBUExchangeRate();
    }

    /// An affordance of last resort for Main in order to ensure re-capitalization
    /// @custom:protected
    function setBasketsNeeded(uint192 basketsNeeded_) external notPausedOrFrozen {
        require(_msgSender() == address(main.backingManager()), "not backing manager");
        emit BasketsNeededChanged(basketsNeeded, basketsNeeded_);
        basketsNeeded = basketsNeeded_;
        requireValidBUExchangeRate();
    }

    /// @return {qRTok} The maximum redemption that can be performed in the current block
    function redemptionLimit() external view returns (uint256) {
        return battery.currentCharge(totalSupply());
    }

    /// For testing compatibility with P1
    function validP1IssueItemIndex(address account, uint256 index) external view returns (bool) {
        return leftIndex(account) >= index && index < rightIndex(account);
    }

    /// Tries to vest an issuance
    /// @return issued The total amount of RToken minted
    function tryVestIssuance(address issuer, uint256 index) internal returns (uint256 issued) {
        SlowIssuance storage iss = issuances[issuer][index];
        uint48 basketNonce = main.basketHandler().nonce();
        require(iss.blockAvailableAt.lte(toFix(block.number)), "issuance not ready");
        assert(iss.basketNonce == basketNonce); // this should always be true at this point

        if (!iss.processed) {
            for (uint256 i = 0; i < iss.erc20s.length; i++) {
                liabilities[IERC20(iss.erc20s[i])] -= iss.deposits[i];
                IERC20(iss.erc20s[i]).safeTransfer(address(main.backingManager()), iss.deposits[i]);
            }
            _mint(iss.issuer, iss.amount);

            issued = iss.amount;

            emit BasketsNeededChanged(basketsNeeded, basketsNeeded.plus(iss.baskets));
            basketsNeeded = basketsNeeded.plus(iss.baskets);

            iss.processed = true;
            emit Issuance(issuer, iss.amount, iss.baskets);
        }
    }

    /// Returns the block number at which an issuance for *amount* now can complete
    function nextIssuanceBlockAvailable(uint256 amount) private returns (uint192) {
        uint192 before = fixMax(toFix(block.number - 1), allVestAt);

        // Calculate the issuance rate if this is the first issue in the block
        if (blockIssuanceRates[block.number] == 0) {
            blockIssuanceRates[block.number] = Math.max(
                MIN_BLOCK_ISSUANCE_LIMIT,
                issuanceRate.mulu_toUint(totalSupply())
            );
        }
        uint256 perBlock = blockIssuanceRates[block.number];
        allVestAt = before.plus(FIX_ONE.muluDivu(amount, perBlock, CEIL));
        return allVestAt;
    }

    function refundAndClearStaleIssuances(address account) private returns (bool) {
        uint48 basketNonce = main.basketHandler().nonce();
        bool someProcessed = false;
        uint256 amount;
        uint256 startIndex;
        uint256 endIndex;

        for (uint256 i = 0; i < issuances[account].length; i++) {
            SlowIssuance storage iss = issuances[account][i];
            if (!iss.processed && iss.basketNonce != basketNonce) {
                amount += iss.amount;

                if (!someProcessed) startIndex = i;
                someProcessed = true;

                for (uint256 j = 0; j < iss.erc20s.length; j++) {
                    IERC20(iss.erc20s[j]).safeTransfer(iss.issuer, iss.deposits[j]);
                }
                iss.processed = true;
                endIndex = i + 1;
            }
        }

        if (someProcessed) {
            emit IssuancesCanceled(account, startIndex, endIndex, amount);
            // Clear queue
            for (int256 i = int256(issuances[account].length) - 1; i >= 0; i--) {
                issuances[account].pop();
            }
        }
        return someProcessed;
    }

    /// Require the BU to RToken exchange rate to be in [1e-9, 1e9]
    function requireValidBUExchangeRate() private view {
        uint256 supply = totalSupply();
        if (supply == 0) return;

        uint256 low = (FIX_ONE_256 * basketsNeeded) / supply;
        uint256 high = (FIX_ONE_256 * basketsNeeded + (supply - 1)) / supply;

        // We can't assume we can downcast to uint192 safely. Note that the
        // uint192 check below is redundant but this is P0 so we keep it.
        require(
            low <= type(uint192).max &&
                high <= type(uint192).max &&
                uint192(low) >= FIX_ONE / 1e9 &&
                uint192(high) <= FIX_ONE * 1e9,
            "BU rate out of range"
        );
    }

    /// Returns the left index of currently-valid items for `account`
    /// For P1 Compatibility - Equivalent to RTokenP1.IssueQueue.left
    function leftIndex(address account) private view returns (uint256) {
        SlowIssuance[] storage queue = issuances[account];
        uint256 _left;
        for (uint256 i = 0; i < queue.length; i++) {
            SlowIssuance storage iss = queue[i];
            if (!iss.processed) {
                break;
            }
            _left++;
        }
        return _left;
    }

    /// Returns the right index of currently-valid items
    /// For P1 Compatibility - Equivalent to RTokenP1.IssueQueue.right
    function rightIndex(address account) private view returns (uint256) {
        SlowIssuance[] storage queue = issuances[account];
        uint256 _right = leftIndex(account);
        for (uint256 i = _right; i < queue.length; i++) {
            SlowIssuance storage iss = queue[i];
            if (!iss.processed) {
                _right++;
            }
        }
        return _right;
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
}
