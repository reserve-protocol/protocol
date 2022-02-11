// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/draft-ERC20Permit.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/interfaces/IRToken.sol";
import "contracts/libraries/Fixed.sol";

/**
 * @title RTokenP0
 * @notice An ERC20 with an elastic supply and governable exchange rate to basket units.
 */
contract RTokenP0 is Ownable, ERC20Permit, IRToken {
    using SafeERC20 for IERC20Metadata;
    using SafeERC20 for IERC20;
    using FixLib for Fix;

    IMain public main;

    Fix public constant MIN_ISSUANCE_RATE = Fix.wrap(1e40); // {qRTok/block} 10k whole RTok

    SlowIssuance[] public issuances;

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
    /// @param deposits {qTok}
    function issue(
        address issuer,
        uint256 amount,
        Fix baskets,
        address[] memory erc20s,
        uint256[] memory deposits
    ) external override onlyMain {
        assert(erc20s.length == deposits.length);

        // Assumption: Main has already deposited the collateral
        SlowIssuance memory iss = SlowIssuance({
            blockStartedAt: block.number,
            amount: amount,
            baskets: baskets,
            erc20s: erc20s,
            deposits: deposits,
            issuer: issuer,
            blockAvailableAt: nextIssuanceBlockAvailable(amount),
            processed: false
        });
        issuances.push(iss);

        emit IssuanceStarted(
            issuances.length - 1,
            iss.issuer,
            iss.amount,
            iss.baskets,
            iss.erc20s,
            iss.deposits,
            iss.blockAvailableAt
        );

        // Complete issuance instantly if it fits into this block
        if (iss.blockAvailableAt.lte(toFix(block.number))) {
            completeIssuance(issuances.length - 1);
        }
    }

    /// Cancels a vesting slow issuance
    /// @param issuanceId The id of the issuance, emitted at issuance start
    function cancelIssuance(uint256 issuanceId) external override {
        SlowIssuance storage iss = issuances[issuanceId];
        require(iss.issuer == _msgSender(), "issuer does not match caller");
        require(!iss.processed, "issuance already processed");

        for (uint256 i = 0; i < iss.erc20s.length; i++) {
            IERC20(iss.erc20s[i]).safeTransfer(iss.issuer, iss.deposits[i]);
        }

        iss.processed = true;
        emit IssuanceCanceled(issuanceId);
    }

    /// Completes a vested slow issuance
    /// Anyone can complete another's issuance, unlike cancellation
    /// @param issuanceId The id of the issuance, emitted at issuance start
    function completeIssuance(uint256 issuanceId) public override {
        SlowIssuance storage iss = issuances[issuanceId];
        require(main.worstCollateralStatus() != CollateralStatus.DISABLED, "collateral disabled");
        require(!iss.processed, "issuance already processed");
        require(iss.blockStartedAt > main.blockBasketLastChanged(), "stale issuance");
        require(iss.blockAvailableAt.lte(toFix(block.number)), "issuance not yet ready");

        for (uint256 i = 0; i < iss.erc20s.length; i++) {
            IERC20(iss.erc20s[i]).safeTransfer(address(main), iss.deposits[i]);
        }
        _mint(iss.issuer, iss.amount);

        emit BasketsNeededChanged(basketsNeeded, basketsNeeded.plus(iss.baskets));
        basketsNeeded = basketsNeeded.plus(iss.baskets);

        iss.processed = true;
        emit IssuanceCompleted(issuanceId);
    }

    /// Redeem a quantity of RToken from an account, keeping a roughly constant basket rate
    /// @param from The account redeeeming RToken
    /// @param amount {qTok} The amount to be redeemed
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
    /// @param amount {qTok} The amount to be minted
    function mint(address recipient, uint256 amount) external override onlyMain {
        _mint(recipient, amount);
    }

    /// Melt a quantity of RToken from the caller's account, increasing the basket rate
    /// @param amount {qTok} The amount to be melted
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

    // ==== Private ====

    // Returns the block number at which an issuance for *amount* now can complete
    function nextIssuanceBlockAvailable(uint256 amount) private view returns (Fix) {
        Fix perBlock = fixMax(MIN_ISSUANCE_RATE, main.issuanceRate().mulu(totalSupply()));
        Fix blockStart = toFix(block.number - 1);
        if (
            issuances.length > 0 && issuances[issuances.length - 1].blockAvailableAt.gt(blockStart)
        ) {
            blockStart = issuances[issuances.length - 1].blockAvailableAt;
        }
        return blockStart.plus(divFix(amount, perBlock));
    }
}
