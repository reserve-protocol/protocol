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
 * @notice An ERC20 with an elastic supply.
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

    // Process slow issuances:
    // - undoes any issuances that was started before the basket was last set
    // - enacts any other issuances that are fully vested, sending deposits back to Main
    function poke() public override {
        Fix currentBlock = toFix(block.number);
        bool backingIsSound = main.worstCollateralStatus() == CollateralStatus.SOUND;

        for (uint256 i = 0; i < issuances.length; i++) {
            SlowIssuance storage iss = issuances[i];
            if (iss.processed) continue;

            if (!backingIsSound || iss.blockStartedAt <= main.blockBasketLastChanged()) {
                // Rollback issuance i
                for (uint256 j = 0; j < iss.erc20s.length; j++) {
                    IERC20(iss.erc20s[j]).safeTransfer(iss.issuer, iss.deposits[j]);
                }
                iss.processed = true;
                emit IssuanceCanceled(i);
            } else if (iss.blockAvailableAt.lte(currentBlock)) {
                for (uint256 j = 0; j < iss.erc20s.length; j++) {
                    IERC20(iss.erc20s[j]).safeTransfer(address(main), iss.deposits[j]);
                }

                emit BasketsNeededChanged(basketsNeeded, basketsNeeded.plus(iss.baskets));
                basketsNeeded = basketsNeeded.plus(iss.baskets);

                _mint(iss.issuer, iss.amount);
                iss.processed = true;
                emit IssuanceCompleted(i);
            }
        }
    }

    modifier onlyMain() {
        require(_msgSender() == address(main), "only main");
        _;
    }

    /// Begins the SlowIssuance accounting process
    /// @dev This function assumes `deposits` have already been transferred in
    /// @param issuer The account issuing the RToken
    /// @param amount {qRTok}
    /// @param deposits {qTok}
    function issueSlowly(
        address issuer,
        uint256 amount,
        address[] memory erc20s,
        uint256[] memory deposits
    ) external override onlyMain {
        assert(erc20s.length == deposits.length);

        // Assumption: Main has already deposited the collateral
        SlowIssuance memory iss = SlowIssuance({
            blockStartedAt: block.number,
            amount: amount,
            baskets: basketRate().mulu(amount).shiftLeft(-int8(decimals())),
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
    }

    /// Mint a quantity of RToken to the `recipient`
    /// @param recipient The recipient of the newly minted RToken
    /// @param amount {qTok} The amount to be minted
    function mint(address recipient, uint256 amount) external override onlyMain {
        _mint(recipient, amount);
    }

    /// Melt a quantity of RToken from the caller's account, increasing the basketRate
    /// @param amount {qTok} The amount to be melted
    function melt(uint256 amount) external override {
        _burn(_msgSender(), amount);
    }

    /// Redeem a quantity of RToken from an account
    /// @param from The account redeeeming RToken
    /// @param amount {qTok} The amount to be redeemed
    function redeem(address from, uint256 amount) external override onlyMain {
        Fix initialRate = basketRate();

        // {BU} = {BU/rTok} / {qRTok/rTok} * {qRTok}
        Fix baskets = initialRate.shiftLeft(-int8(decimals())).mulu(amount); // {BU}
        _burn(from, amount);

        basketsNeeded = basketsNeeded.minus(baskets);
        assert(basketsNeeded.gte(FIX_ZERO));
        assert(basketRate().gte(initialRate));
    }

    /// An affordance of last resort for Main in order to ensure re-capitalization
    function setBasketsNeeded(Fix basketsNeeded_) external override onlyMain {
        basketsNeeded = basketsNeeded_;
    }

    function setMain(IMain main_) external override onlyOwner {
        emit MainSet(main, main_);
        main = main_;
    }

    /// @return {BU/rTok} Basket units per whole RToken
    function basketRate() public view override returns (Fix) {
        uint256 supply = totalSupply();
        if (supply == 0) {
            return FIX_ONE;
        }

        // {BU/rTok} = {BU} * {qRTok/rTok} / {qRTok}
        return basketsNeeded.shiftLeft(int8(decimals())).divu(supply);
    }

    // ==== Private ====

    // Returns the future block number at which an issuance for *amount* now can complete
    function nextIssuanceBlockAvailable(uint256 amount) private view returns (Fix) {
        Fix perBlock = fixMax(MIN_ISSUANCE_RATE, main.issuanceRate().mulu(totalSupply()));
        Fix blockStart = toFix(block.number);
        if (
            issuances.length > 0 && issuances[issuances.length - 1].blockAvailableAt.gt(blockStart)
        ) {
            blockStart = issuances[issuances.length - 1].blockAvailableAt;
        }
        return blockStart.plus(divFix(amount, perBlock));
    }
}
