// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
// solhint-disable-next-line max-line-length
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/draft-ERC20PermitUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "contracts/interfaces/IMain.sol";
import "contracts/interfaces/IBasketHandler.sol";
import "contracts/interfaces/IRToken.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/p0/mixins/Component.sol";
import "contracts/p0/mixins/Rewardable.sol";

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
contract RTokenP0 is ComponentP0, RewardableP0, ERC20Upgradeable, ERC20PermitUpgradeable, IRToken {
    using EnumerableSet for EnumerableSet.AddressSet;
    using FixLib for uint192;
    using SafeERC20 for IERC20;

    /// Expected to be an IPFS hash
    string public manifestoURI;

    // To enforce a fixed issuanceRate throughout the entire block
    mapping(uint256 => uint256) private blockIssuanceRates; // block.number => {qRTok/block}

    // MIN_ISSUANCE_RATE: {qRTok/block} 10k whole RTok
    uint256 public constant MIN_ISSUANCE_RATE = 10_000 * FIX_ONE;

    // List of accounts. If issuances[user].length > 0 then (user is in accounts)
    EnumerableSet.AddressSet internal accounts;

    mapping(address => SlowIssuance[]) public issuances;

    // When all pending issuances will have vested.
    // This is fractional so that we can represent partial progress through a block.
    uint192 public allVestAt; // {fractional block number}

    uint192 public basketsNeeded; //  {BU}

    uint192 public issuanceRate; // {1/block} of RToken supply to issue per block

    function init(
        IMain main_,
        string memory name_,
        string memory symbol_,
        string memory manifestoURI_,
        uint192 issuanceRate_
    ) public initializer {
        __Component_init(main_);
        __ERC20_init(name_, symbol_);
        __ERC20Permit_init(name_);
        manifestoURI = manifestoURI_;
        issuanceRate = issuanceRate_;
        emit IssuanceRateSet(FIX_ZERO, issuanceRate);
    }

    function setIssuanceRate(uint192 val) external governance {
        emit IssuanceRateSet(issuanceRate, val);
        issuanceRate = val;
    }

    /// Begin a time-delayed issuance of RToken for basket collateral
    /// @param amount {qTok} The quantity of RToken to issue
    /// @custom:interaction
    function issue(uint256 amount) external notPaused {
        require(amount > 0, "Cannot issue zero");
        // Call collective state keepers.
        main.poke();

        IBasketHandler basketHandler = main.basketHandler();
        require(basketHandler.status() != CollateralStatus.DISABLED, "basket disabled");

        address issuer = _msgSender();
        refundAndClearStaleIssuances(issuer);

        // Compute # of baskets to create `amount` qRTok
        uint192 baskets = (totalSupply() > 0) // {BU}
            ? basketsNeeded.muluDivu(amount, totalSupply()) // {BU * qRTok / qRTok}
            : shiftl_toFix(amount, -int8(decimals())); // {qRTok / qRTok}

        (address[] memory erc20s, uint256[] memory deposits) = basketHandler.quote(baskets, CEIL);
        // Accept collateral
        for (uint256 i = 0; i < erc20s.length; i++) {
            IERC20(erc20s[i]).safeTransferFrom(issuer, address(this), deposits[i]);
        }

        // Add a new SlowIssuance ticket to the queue
        (uint256 basketNonce, ) = main.basketHandler().lastSet();
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
            emit IssuancesCompleted(issuer, index, index);
            assert(vestedAmount == iss.amount);
            delete issuances[issuer][index];
        }
    }

    /// Cancels a vesting slow issuance
    /// @custom:interaction
    /// If earliest == true, cancel id if id < endId
    /// If earliest == false, cancel id if endId <= id
    /// @param endId One end of the range of issuance IDs to cancel
    /// @param earliest If true, cancel earliest issuances; else, cancel latest issuances
    /// @custom:interaction
    function cancel(uint256 endId, bool earliest) external notPaused {
        // Call collective state keepers.
        main.poke();

        address account = _msgSender();

        SlowIssuance[] storage queue = issuances[account];
        (uint256 first, uint256 last) = earliest ? (0, endId) : (endId, queue.length);

        uint256 left;
        for (uint256 n = first; n < last; n++) {
            SlowIssuance storage iss = queue[n];
            if (!iss.processed) {
                for (uint256 i = 0; i < iss.erc20s.length; i++) {
                    IERC20(iss.erc20s[i]).safeTransfer(iss.issuer, iss.deposits[i]);
                }
                iss.processed = true;

                if (left == 0) left = n;
            }
        }
        emit IssuancesCanceled(account, left, last);
    }

    /// Completes all vested slow issuances for the account, callable by anyone
    /// @param account The address of the account to vest issuances for
    /// @custom:interaction
    function vest(address account, uint256 endId) external notPaused {
        // Call collective state keepers.
        main.poke();

        require(main.basketHandler().status() == CollateralStatus.SOUND, "collateral default");

        refundAndClearStaleIssuances(account);

        uint256 first;
        uint256 totalVested;
        for (uint256 i = 0; i < endId && i < issuances[account].length; i++) {
            uint256 vestedAmount = tryVestIssuance(account, i);
            totalVested += vestedAmount;
            if (first == 0 && vestedAmount > 0) first = i;
        }
        if (totalVested > 0) emit IssuancesCompleted(account, first, endId);
    }

    /// Return the highest index that could be completed by a vestIssuances call.
    function endIdForVest(address account) external view returns (uint256) {
        uint256 i = 0;
        uint192 currBlock = toFix(block.number);
        SlowIssuance[] storage queue = issuances[account];

        while (i < queue.length && queue[i].blockAvailableAt.lte(currBlock)) i++;
        return i;
    }

    /// Redeem RToken for basket collateral
    /// @param amount {qTok} The quantity {qRToken} of RToken to redeem
    /// @custom:interaction
    function redeem(uint256 amount) external notFullyPaused {
        require(amount > 0, "Cannot redeem zero");
        require(balanceOf(_msgSender()) >= amount, "not enough RToken");

        // Call collective state keepers.
        main.poke();

        IBasketHandler basketHandler = main.basketHandler();
        require(basketHandler.status() != CollateralStatus.DISABLED, "collateral default");

        // {BU} = {BU} * {qRTok} / {qRTok}
        uint192 baskets = basketsNeeded.muluDivu(amount, totalSupply());
        assert(baskets.lte(basketsNeeded));
        emit Redemption(_msgSender(), amount, baskets);

        (address[] memory erc20s, uint256[] memory amounts) = basketHandler.quote(baskets, FLOOR);

        // {1} = {qRTok} / {qRTok}
        uint192 prorate = toFix(amount).divu(totalSupply());

        // Accept and burn RToken
        _burn(_msgSender(), amount);

        emit BasketsNeededChanged(basketsNeeded, basketsNeeded.minus(baskets));
        basketsNeeded = basketsNeeded.minus(baskets);

        // ==== Send back collateral tokens ====
        IBackingManager backingMgr = main.backingManager();

        for (uint256 i = 0; i < erc20s.length; i++) {
            // Bound each withdrawal by the prorata share, in case we're currently under-capitalized
            uint256 bal = IERC20(erc20s[i]).balanceOf(address(backingMgr));
            // {qTok} = {1} * {qTok}
            uint256 prorata = prorate.mulu_toUint(bal);
            amounts[i] = Math.min(amounts[i], prorata);
            // Send withdrawal
            IERC20(erc20s[i]).safeTransferFrom(address(backingMgr), _msgSender(), amounts[i]);
        }
    }

    /// Mint a quantity of RToken to the `recipient`, decreasing the basket rate
    /// @param recipient The recipient of the newly minted RToken
    /// @param amount {qRTok} The amount to be minted
    /// @custom:protected
    function mint(address recipient, uint256 amount) external notPaused {
        require(_msgSender() == address(main.backingManager()), "not backing manager");
        _mint(recipient, amount);
    }

    /// Melt a quantity of RToken from the caller's account, increasing the basket rate
    /// @param amount {qRTok} The amount to be melted
    function melt(uint256 amount) external notPaused {
        _burn(_msgSender(), amount);
        emit Melted(amount);
    }

    /// An affordance of last resort for Main in order to ensure re-capitalization
    /// @custom:protected
    function setBasketsNeeded(uint192 basketsNeeded_) external notPaused {
        require(_msgSender() == address(main.backingManager()), "not backing manager");
        emit BasketsNeededChanged(basketsNeeded, basketsNeeded_);
        basketsNeeded = basketsNeeded_;
    }

    /// @return {UoA/rTok} The protocol's best guess of the RToken price on markets
    function price() external view returns (uint192) {
        if (totalSupply() == 0) return main.basketHandler().price();

        // {UoA/rTok} = {UoA/BU} * {BU} / {rTok}
        uint192 supply = shiftl_toFix(totalSupply(), -int8(decimals()));
        return main.basketHandler().price().mulDiv(basketsNeeded, supply);
    }

    /// Tries to vest an issuance
    /// @return issued The total amount of RToken minted
    function tryVestIssuance(address issuer, uint256 index) internal returns (uint256 issued) {
        SlowIssuance storage iss = issuances[issuer][index];
        (uint256 basketNonce, ) = main.basketHandler().lastSet();
        require(iss.blockAvailableAt.lte(toFix(block.number)), "issuance not ready");
        assert(iss.basketNonce == basketNonce); // this should always be true at this point

        if (!iss.processed) {
            for (uint256 i = 0; i < iss.erc20s.length; i++) {
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
                MIN_ISSUANCE_RATE,
                issuanceRate.mulu_toUint(totalSupply())
            );
        }
        uint256 perBlock = blockIssuanceRates[block.number];
        allVestAt = before.plus(FIX_ONE.muluDivu(amount, perBlock));
        return allVestAt;
    }

    function refundAndClearStaleIssuances(address account) private {
        (uint256 basketNonce, ) = main.basketHandler().lastSet();
        bool clearQueue = false;
        for (uint256 i = 0; i < issuances[account].length; i++) {
            SlowIssuance storage iss = issuances[account][i];
            if (!iss.processed && iss.basketNonce != basketNonce) {
                for (uint256 j = 0; j < iss.erc20s.length; j++) {
                    IERC20(iss.erc20s[j]).safeTransfer(iss.issuer, iss.deposits[j]);
                }
                iss.processed = true;
            }
            if (iss.basketNonce != basketNonce) clearQueue = true;
        }

        if (clearQueue) delete issuances[account]; // to mimic RTokenP1 endIds for future issuance
    }
}
