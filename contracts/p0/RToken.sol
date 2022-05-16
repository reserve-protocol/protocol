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
    int192 baskets; // {BU}
    address[] erc20s;
    uint256[] deposits;
    uint256 basketNonce;
    int192 blockAvailableAt; // {block.number} fractional
    bool processed;
}

/**
 * @title RTokenP0
 * @notice An ERC20 with an elastic supply and governable exchange rate to basket units.
 */
contract RTokenP0 is ComponentP0, RewardableP0, ERC20Upgradeable, ERC20PermitUpgradeable, IRToken {
    using EnumerableSet for EnumerableSet.AddressSet;
    using FixLib for int192;
    using SafeERC20 for IERC20;

    /// Expected to be an IPFS hash
    string public constitutionURI;

    // To enforce a fixed issuanceRate throughout the entire block
    // TODO: simplify
    mapping(uint256 => uint256) private blockIssuanceRates; // block.number => {qRTok/block}

    // MIN_ISSUANCE_RATE: {qRTok/block} 10k whole RTok
    uint256 public constant MIN_ISSUANCE_RATE = 10_000 * 1e18;

    // List of accounts. If issuances[user].length > 0 then (user is in accounts)
    EnumerableSet.AddressSet internal accounts;

    mapping(address => SlowIssuance[]) public issuances;

    int192 public basketsNeeded; //  {BU}

    int192 public issuanceRate; // {1/block} of RToken supply to issue per block

    function init(
        IMain main_,
        string memory name_,
        string memory symbol_,
        string memory constitutionURI_,
        int192 issuanceRate_
    ) public initializer {
        __Component_init(main_);
        __ERC20_init(name_, symbol_);
        __ERC20Permit_init(name_);
        constitutionURI = constitutionURI_;
        issuanceRate = issuanceRate_;
        emit IssuanceRateSet(FIX_ZERO, issuanceRate);
    }

    function setIssuanceRate(int192 val) external governance {
        emit IssuanceRateSet(issuanceRate, val);
        issuanceRate = val;
    }

    /// Begin a time-delayed issuance of RToken for basket collateral
    /// @param amount {qTok} The quantity of RToken to issue
    /// @custom:interaction
    function issue(uint256 amount) external interaction {
        require(amount > 0, "Cannot issue zero");
        // Call collective state keepers.
        main.poke();

        IBasketHandler basketHandler = main.basketHandler();
        require(basketHandler.status() != CollateralStatus.DISABLED, "basket disabled");

        (uint256 basketNonce, ) = main.basketHandler().lastSet();
        address issuer = _msgSender();

        // Compute # of baskets to create `amount` qRTok
        int192 baskets = (totalSupply() > 0) // {BU}
            ? basketsNeeded.muluDivu(amount, totalSupply()) // {BU * qRTok / qRTok}
            : shiftl_toFix(amount, -int8(decimals())); // {qRTok / qRTok}

        (address[] memory erc20s, uint256[] memory deposits) = basketHandler.quote(baskets, CEIL);
        // Accept collateral
        for (uint256 i = 0; i < erc20s.length; i++) {
            IERC20(erc20s[i]).safeTransferFrom(issuer, address(this), deposits[i]);
        }

        // Add a new SlowIssuance ticket to the queue
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

        emit IssuanceStarted(
            iss.issuer,
            issuances[issuer].length - 1,
            iss.amount,
            iss.baskets,
            iss.erc20s,
            iss.deposits,
            iss.blockAvailableAt
        );

        // Complete issuance instantly if it fits into this block
        if (iss.blockAvailableAt.lte(toFix(block.number))) {
            require(basketHandler.status() == CollateralStatus.SOUND, "collateral not sound");

            // At this point all checks have been done to ensure the issuance should vest
            uint256 vestedAmount = tryVestIssuance(issuer, issuances[issuer].length - 1);
            assert(vestedAmount == iss.amount);
        }
    }

    /// Cancels a vesting slow issuance
    /// @custom:interaction
    /// If earliest == true, cancel id if id < endId
    /// If earliest == false, cancel id if endId <= id
    /// @param endId One end of the range of issuance IDs to cancel
    /// @param earliest If true, cancel earliest issuances; else, cancel latest issuances
    /// @custom:interaction
    function cancel(uint256 endId, bool earliest) external interaction {
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
    function vest(address account, uint256 endId) external interaction {
        // Call collective state keepers.
        main.poke();

        require(main.basketHandler().status() == CollateralStatus.SOUND, "collateral default");

        for (uint256 i = 0; i < endId; i++) tryVestIssuance(account, i);
    }

    /// Return the highest index that could be completed by a vestIssuances call.
    function endIdForVest(address account) external view returns (uint256) {
        uint256 i = 0;
        int192 currBlock = toFix(block.number);
        SlowIssuance[] storage queue = issuances[account];

        while (i < queue.length && queue[i].blockAvailableAt.lte(currBlock)) i++;
        return i;
    }

    /// Redeem RToken for basket collateral
    /// @param amount {qTok} The quantity {qRToken} of RToken to redeem
    /// @custom:interaction
    function redeem(uint256 amount) external interaction {
        require(amount > 0, "Cannot redeem zero");
        require(balanceOf(_msgSender()) >= amount, "not enough RToken");

        // Call collective state keepers.
        main.poke();

        IBasketHandler basketHandler = main.basketHandler();
        require(basketHandler.status() != CollateralStatus.DISABLED, "collateral default");

        // {BU} = {BU} * {qRTok} / {qRTok}
        int192 baskets = basketsNeeded.muluDivu(amount, totalSupply());
        assert(baskets.lte(basketsNeeded));
        emit Redemption(_msgSender(), amount, baskets);

        (address[] memory erc20s, uint256[] memory amounts) = basketHandler.quote(baskets, FLOOR);

        // {1} = {qRTok} / {qRTok}
        int192 prorate = toFix(amount).divu(totalSupply());

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
    function setBasketsNeeded(int192 basketsNeeded_) external notPaused {
        require(_msgSender() == address(main.backingManager()), "not backing manager");
        emit BasketsNeededChanged(basketsNeeded, basketsNeeded_);
        basketsNeeded = basketsNeeded_;
    }

    /// @return {UoA/rTok} The protocol's best guess of the RToken price on markets
    function price() external view returns (int192) {
        if (totalSupply() == 0) return main.basketHandler().price();

        // {UoA/rTok} = {UoA/BU} * {BU} / {rTok}
        int192 supply = shiftl_toFix(totalSupply(), -int8(decimals()));
        return main.basketHandler().price().mulDiv(basketsNeeded, supply);
    }

    /// Tries to vest an issuance
    /// @return issued The total amount of RToken minted
    function tryVestIssuance(address issuer, uint256 index) internal returns (uint256 issued) {
        SlowIssuance storage iss = issuances[issuer][index];
        (uint256 basketNonce, ) = main.basketHandler().lastSet();
        if (
            !iss.processed &&
            iss.basketNonce == basketNonce &&
            iss.blockAvailableAt.lte(toFix(block.number))
        ) {
            for (uint256 i = 0; i < iss.erc20s.length; i++) {
                IERC20(iss.erc20s[i]).safeTransfer(address(main.backingManager()), iss.deposits[i]);
            }
            _mint(iss.issuer, iss.amount);
            issued = iss.amount;

            emit BasketsNeededChanged(basketsNeeded, basketsNeeded.plus(iss.baskets));
            basketsNeeded = basketsNeeded.plus(iss.baskets);

            iss.processed = true;
            emit IssuancesCompleted(issuer, index, index);
        }
    }

    /// Returns the block number at which an issuance for *amount* now can complete
    function nextIssuanceBlockAvailable(uint256 amount) private returns (int192) {
        int192 before = toFix(block.number - 1);

        // Calculate the issuance rate if this is the first issue in the block
        if (blockIssuanceRates[block.number] == 0) {
            blockIssuanceRates[block.number] = Math.max(
                MIN_ISSUANCE_RATE,
                issuanceRate.mulu_toUint(totalSupply())
            );
        }
        uint256 perBlock = blockIssuanceRates[block.number];

        for (uint256 i = 0; i < accounts.length(); i++) {
            SlowIssuance[] storage queue = issuances[accounts.at(i)];
            if (queue.length > 0 && queue[queue.length - 1].blockAvailableAt.gt(before)) {
                before = queue[queue.length - 1].blockAvailableAt;
            }
        }
        return before.plus(FIX_ONE.muluDivu(amount, perBlock));
    }
}
