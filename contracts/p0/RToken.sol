// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/draft-ERC20Permit.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
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

    IMain public main;

    // To enforce a fixed issuanceRate throughout the entire block
    mapping(uint256 => Fix) private issuanceRate; // block.number => {qRTok/block}

    Fix public constant MIN_ISSUANCE_RATE = Fix.wrap(1e40); // {qRTok/block} 10k whole RTok

    // List of accounts. If issuances[user].length > 0 then (user is in accounts)
    EnumerableSet.AddressSet internal accounts;

    mapping(address => SlowIssuance[]) public issuances;

    Fix public override basketsNeeded; //  {BU}

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
    /// @dev This function assumes that `baskets` will be due to issuer after slow issuance.
    /// @param issuer The account issuing the RToken
    /// @param amount {qRTok}
    /// @param baskets {BU}
    /// @param deposits {qRTok}
    function issue(
        address issuer,
        uint256 amount,
        Fix baskets,
        IERC20Metadata[] memory erc20s,
        uint256[] memory deposits
    ) external override onlyMain {
        assert(erc20s.length == deposits.length);

        // Calculate the issuance rate if this is the first issue in the block
        if (issuanceRate[block.number].eq(FIX_ZERO)) {
            issuanceRate[block.number] = fixMax(
                MIN_ISSUANCE_RATE,
                main.issuanceRate().mulu(totalSupply())
            );
        }

        // Assumption: Main has already deposited the collateral
        SlowIssuance memory iss = SlowIssuance({
            issuer: issuer,
            amount: amount,
            baskets: baskets,
            erc20s: erc20s,
            deposits: deposits,
            basketNonce: main.basketNonce(),
            blockAvailableAt: nextIssuanceBlockAvailable(amount, issuanceRate[block.number]),
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
            assert(tryVestIssuance(issuer, issuances[issuer].length - 1) > 0);
        }
    }

    /// Cancels a vesting slow issuance
    /// @param account The account of the issuer, and caller
    /// @param index The index of the issuance in the issuer's queue
    function cancelIssuance(address account, uint256 index) external override {
        require(account == _msgSender(), "issuer does not match caller");
        SlowIssuance storage iss = issuances[_msgSender()][index];
        require(!iss.processed, "issuance already processed");

        for (uint256 i = 0; i < iss.erc20s.length; i++) {
            iss.erc20s[i].safeTransfer(iss.issuer, iss.deposits[i]);
        }

        iss.processed = true;
        emit IssuanceCanceled(iss.issuer, index);
    }

    /// Completes all vested slow issuances for the account, callable by anyone
    /// @param account The address of the account to vest issuances for
    /// @return vested {qRTok} The total amount of RToken quanta vested
    function vestIssuances(address account) external override returns (uint256 vested) {
        require(!main.paused(), "main is paused");
        require(main.worstCollateralStatus() == CollateralStatus.SOUND, "collateral default");

        for (uint256 i = 0; i < issuances[account].length; i++) {
            vested += tryVestIssuance(account, i);
        }
    }

    /// Redeem a quantity of RToken from an account, keeping a roughly constant basket rate
    /// @param from The account redeeeming RToken
    /// @param amount {qRTok} The amount to be redeemed
    /// @param baskets {BU}
    function redeem(
        address from,
        uint256 amount,
        Fix baskets
    ) external override onlyMain {
        _burn(from, amount);

        emit BasketsNeededChanged(basketsNeeded, basketsNeeded.minus(baskets));
        basketsNeeded = basketsNeeded.minus(baskets);

        assert(basketsNeeded.gte(FIX_ZERO));
    }

    /// Mint a quantity of RToken to the `recipient`, decreasing the basket rate
    /// @param recipient The recipient of the newly minted RToken
    /// @param amount {qRTok} The amount to be minted
    function mint(address recipient, uint256 amount) external override onlyMain {
        _mint(recipient, amount);
    }

    /// Melt a quantity of RToken from the caller's account, increasing the basket rate
    /// @param amount {qRTok} The amount to be melted
    function melt(uint256 amount) external override {
        _burn(_msgSender(), amount);
        emit Melted(amount);
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

    /// Tries to vest an issuance
    /// @return issued The total amount of RToken minted
    function tryVestIssuance(address issuer, uint256 index) internal returns (uint256 issued) {
        SlowIssuance storage iss = issuances[issuer][index];
        if (
            !iss.processed &&
            iss.basketNonce == main.basketNonce() &&
            iss.blockAvailableAt.lte(toFix(block.number))
        ) {
            for (uint256 i = 0; i < iss.erc20s.length; i++) {
                iss.erc20s[i].safeTransfer(address(main), iss.deposits[i]);
            }
            _mint(iss.issuer, iss.amount);
            issued = iss.amount;

            emit BasketsNeededChanged(basketsNeeded, basketsNeeded.plus(iss.baskets));
            basketsNeeded = basketsNeeded.plus(iss.baskets);

            iss.processed = true;
            emit IssuanceCompleted(issuer, index);
        }
    }

    /// Returns the block number at which an issuance for *amount* now can complete
    /// @param perBlock {qRTok/block} The uniform rate limit across the block
    function nextIssuanceBlockAvailable(uint256 amount, Fix perBlock) private view returns (Fix) {
        Fix before = toFix(block.number - 1);
        for (uint256 i = 0; i < accounts.length(); i++) {
            SlowIssuance[] storage queue = issuances[accounts.at(i)];
            if (queue.length > 0 && queue[queue.length - 1].blockAvailableAt.gt(before)) {
                before = queue[queue.length - 1].blockAvailableAt;
            }
        }
        return before.plus(divFix(amount, perBlock));
    }
}
