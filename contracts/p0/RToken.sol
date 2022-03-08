// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/draft-ERC20Permit.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "contracts/interfaces/IMain.sol";
import "contracts/interfaces/IBasketHandler.sol";
import "contracts/interfaces/IRToken.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/p0/Rewardable.sol";

struct SlowIssuance {
    address issuer;
    uint256 amount; // {qRTok}
    Fix baskets; // {BU}
    address[] erc20s;
    uint256[] deposits; // {qTok}, same index as vault basket assets
    uint256 basketNonce;
    Fix blockAvailableAt; // {block.number} fractional
    bool processed;
}

/**
 * @title RTokenP0
 * @notice An ERC20 with an elastic supply and governable exchange rate to basket units.
 */
contract RTokenP0 is RewardableP0, ERC20Permit, IRToken {
    using EnumerableSet for EnumerableSet.AddressSet;
    using FixLib for Fix;
    using SafeERC20 for IERC20;

    // To enforce a fixed issuanceRate throughout the entire block
    // TODO: simplify
    mapping(uint256 => Fix) private blockIssuanceRates; // block.number => {qRTok/block}

    Fix public constant MIN_ISSUANCE_RATE = Fix.wrap(1e40); // {qRTok/block} 10k whole RTok

    // List of accounts. If issuances[user].length > 0 then (user is in accounts)
    EnumerableSet.AddressSet internal accounts;

    mapping(address => SlowIssuance[]) public issuances;

    Fix public basketsNeeded; //  {BU}

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

    /// Begin a time-delayed issuance of RToken for basket collateral
    /// User Action
    /// @param amount {qTok} The quantity of RToken to issue
    /// @return deposits {qTok} The quantities of collateral tokens transferred in
    function issue(uint256 amount) external notPaused returns (uint256[] memory deposits) {
        require(amount > 0, "Cannot issue zero");
        // Call collective state keepers.
        main.poke();
        IBasketHandler basketHandler = main.basketHandler();
        require(basketHandler.status() == CollateralStatus.SOUND, "collateral not sound");
        (uint256 basketNonce, ) = main.basketHandler().lastSet();

        address issuer = _msgSender();

        // Compute # of baskets to create `amount` qRTok
        Fix baskets = (totalSupply() > 0) // {BU}
            ? basketsNeeded.mulu(amount).divuRound(totalSupply()) // {BU * qRTok / qRTok}
            : main.assetRegistry().toAsset(this).fromQ(toFix(amount)); // {qRTok / qRTok}

        address[] memory erc20s;
        (erc20s, deposits) = basketHandler.quote(baskets, RoundingApproach.CEIL);

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
            // At this point all checks have been done to ensure the issuance should vest
            uint256 vestedAmount = tryVestIssuance(issuer, issuances[issuer].length - 1);
            assert(vestedAmount == iss.amount);
        }
    }

    /// Cancels a vesting slow issuance
    /// User Action
    /// If earliest == true, cancel id if id < endId
    /// If earliest == false, cancel id if endId <= id
    /// @param endId One end of the range of issuance IDs to cancel
    /// @param earliest If true, cancel earliest issuances; else, cancel latest issuances
    function cancel(uint256 endId, bool earliest) external returns (uint256[] memory deposits) {
        address account = _msgSender();

        SlowIssuance[] storage queue = issuances[account];
        (uint256 first, uint256 last) = earliest ? (0, endId) : (endId, queue.length);

        for (uint256 n = first; n < last; n++) {
            SlowIssuance storage iss = queue[n];
            if (!iss.processed) {
                deposits = new uint256[](iss.erc20s.length);
                for (uint256 i = 0; i < iss.erc20s.length; i++) {
                    IERC20(iss.erc20s[i]).safeTransfer(iss.issuer, iss.deposits[i]);
                    deposits[i] += iss.deposits[i];
                }
                iss.processed = true;
            }
        }
        emit IssuancesCanceled(account, first, last);
    }

    /// Completes all vested slow issuances for the account, callable by anyone
    /// @param account The address of the account to vest issuances for
    /// @return vested {qRTok} The total amount of RToken quanta vested
    function vest(address account, uint256 endId) external notPaused returns (uint256 vested) {
        require(main.basketHandler().status() == CollateralStatus.SOUND, "collateral default");

        main.poke();

        for (uint256 i = 0; i < endId; i++) vested += tryVestIssuance(account, i);
    }

    /// Return the highest index that could be completed by a vestIssuances call.
    function endIdForVest(address account) external view returns (uint256) {
        uint256 i;
        Fix currBlock = toFix(block.number);
        SlowIssuance[] storage queue = issuances[account];

        while (i < queue.length && queue[i].blockAvailableAt.lte(currBlock)) i++;
        return i;
    }

    /// Redeem RToken for basket collateral
    /// User Action
    /// @param amount {qTok} The quantity {qRToken} of RToken to redeem
    /// @return withdrawals {qTok} The quantities of collateral tokens transferred out
    function redeem(uint256 amount) external returns (uint256[] memory withdrawals) {
        require(amount > 0, "Cannot redeem zero");
        // Call collective state keepers
        main.poke();
        IBasketHandler basketHandler = main.basketHandler();

        require(balanceOf(_msgSender()) >= amount, "not enough RToken");

        // {BU} = {BU} * {qRTok} / {qRTok}
        Fix baskets = basketsNeeded.mulu(amount).divuRound(totalSupply());
        assert(baskets.lte(basketsNeeded));

        address[] memory erc20s;
        (erc20s, withdrawals) = basketHandler.quote(baskets, RoundingApproach.FLOOR);

        // {1} = {qRTok} / {qRTok}
        Fix prorate = toFix(amount).divu(totalSupply());

        // Accept and burn RToken
        _burn(_msgSender(), amount);

        emit BasketsNeededChanged(basketsNeeded, basketsNeeded.minus(baskets));
        basketsNeeded = basketsNeeded.minus(baskets);

        // ==== Send back collateral tokens ====
        IBackingManager backingMgr = main.backingManager();
        backingMgr.grantAllowances();

        for (uint256 i = 0; i < erc20s.length; i++) {
            // Bound each withdrawal by the prorata share, in case we're currently under-capitalized
            uint256 bal = IERC20(erc20s[i]).balanceOf(address(backingMgr));
            // {qTok} = {1} * {qTok}
            uint256 prorata = prorate.mulu(bal).floor();
            withdrawals[i] = Math.min(withdrawals[i], prorata);
            // Send withdrawal
            IERC20(erc20s[i]).safeTransferFrom(address(backingMgr), _msgSender(), withdrawals[i]);
        }

        emit Redemption(_msgSender(), amount, baskets);
    }

    /// Mint a quantity of RToken to the `recipient`, decreasing the basket rate
    /// @param recipient The recipient of the newly minted RToken
    /// @param amount {qRTok} The amount to be minted
    function mint(address recipient, uint256 amount) external onlyComponent {
        _mint(recipient, amount);
    }

    /// Melt a quantity of RToken from the caller's account, increasing the basket rate
    /// @param amount {qRTok} The amount to be melted
    function melt(uint256 amount) external {
        _burn(_msgSender(), amount);
        emit Melted(amount);
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

    /// @return {qRTok} How much RToken `account` can issue given current holdings
    function maxIssuable(address account) external view returns (uint256) {
        // {BU}
        Fix held = main.basketHandler().basketsHeldBy(account);
        IAsset asset = main.assetRegistry().toAsset(this);

        // return {qRTok} = {BU} * {(1 RToken) qRTok/BU)}
        if (basketsNeeded.eq(FIX_ZERO)) return asset.toQ(held).floor();

        // {qRTok} = {BU} * {qRTok} / {BU}
        return held.mulu(totalSupply()).div(basketsNeeded).floor();
    }

    /// @return p {UoA/rTok} The protocol's best guess of the RToken price on markets
    function price() external view returns (Fix p) {
        IAsset asset = main.assetRegistry().toAsset(this);

        if (totalSupply() == 0) return main.basketHandler().price();

        // {UoA/rTok} = {UoA/BU} * {BU} / {rTok}
        Fix supply = asset.fromQ(toFix(totalSupply()));
        return main.basketHandler().price().mul(basketsNeeded).div(supply);
    }

    /// Returns the block number at which an issuance for *amount* now can complete
    function nextIssuanceBlockAvailable(uint256 amount) private returns (Fix) {
        Fix before = toFix(block.number - 1);

        // Calculate the issuance rate if this is the first issue in the block
        if (blockIssuanceRates[block.number].eq(FIX_ZERO)) {
            blockIssuanceRates[block.number] = fixMax(
                MIN_ISSUANCE_RATE,
                issuanceRate.mulu(totalSupply())
            );
        }
        Fix perBlock = blockIssuanceRates[block.number];

        for (uint256 i = 0; i < accounts.length(); i++) {
            SlowIssuance[] storage queue = issuances[accounts.at(i)];
            if (queue.length > 0 && queue[queue.length - 1].blockAvailableAt.gt(before)) {
                before = queue[queue.length - 1].blockAvailableAt;
            }
        }
        return before.plus(divFix(amount, perBlock));
    }
}
