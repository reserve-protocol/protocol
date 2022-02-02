pragma solidity 0.8.9;
// SPDX-License-Identifier: BlueOak-1.0.0

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/p0/main/SettingsHandler.sol";
import "contracts/p0/main/BasketHandler.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/libraries/Basket.sol";
import "contracts/p0/main/Mixin.sol";
import "contracts/Pausable.sol";
import "./SettingsHandler.sol";
import "./BasketHandler.sol";

/**
 * @title RTokenIssuer
 * @notice Handles issuance and redemption of RToken.
 */
contract RTokenIssuerP0 is Pausable, Mixin, SettingsHandlerP0, BasketHandlerP0, IRTokenIssuer {
    using BasketLib for Basket;
    using SafeERC20 for IERC20Metadata;
    using SafeERC20 for IRToken;
    using FixLib for Fix;

    /// Tracks data for a SlowIssuance
    /// @param blockStartedAt The block number the issuance was started in, non-fractional
    /// @param amount {qTok} The quantity of RToken the issuance is for
    /// @param baskets {qBU} The number of BUs that corresponded to `amount` at time of issuance
    /// @param deposits {qTok} The collateral token quantities that paid for the issuance
    /// @param issuer The account issuing RToken
    /// @param blockAvailableAt {blockNumber} The block number when the issuance completes
    ///   May be a fraction; the issuance is available when block.number >= blackAvailableAt
    /// @param processed false when the issuance is still vesting
    struct SlowIssuance {
        uint256 blockStartedAt;
        uint256 amount; // {qRTok}
        Fix baskets; // {BU}
        address[] erc20s;
        uint256[] deposits; // {qTok}, same index as vault basket assets
        address issuer;
        Fix blockAvailableAt; // {blockNumber} fractional
        bool processed;
    }

    // Slow Issuance
    SlowIssuance[] public issuances;

    function init(ConstructorArgs calldata args)
        public
        virtual
        override(Mixin, SettingsHandlerP0, BasketHandlerP0)
    {
        super.init(args);
    }

    /// Process pending issuances on poke
    function poke() public virtual override(Mixin, BasketHandlerP0) notPaused {
        super.poke();
        revenueFurnace().melt();
        processSlowIssuance();
    }

    /// Begin a time-delayed issuance of RToken for basket collateral
    /// @param amount {qTok} The quantity of RToken to issue
    /// @return deposits {qTok} The quantities of collateral tokens transferred in
    function issue(uint256 amount) public override notPaused returns (uint256[] memory deposits) {
        require(amount > 0, "Cannot issue zero");
        revenueFurnace().melt();
        tryEnsureValidBasket();
        require(worstCollateralStatus() == CollateralStatus.SOUND, "collateral not sound");

        // {BU} = {BU/rTok} * {qRTok} / {qRTok/rTok}
        Fix baskets = basketsPerRTok().mulu(amount).shiftLeft(-int8(rToken().decimals()));
        emit BasketsNeededSet(basketsNeeded, basketsNeeded.plus(baskets));

        deposits = basket.deposit(_msgSender(), baskets);

        // During SlowIssuance, RTokens are minted and held by RToken until vesting completes
        SlowIssuance memory iss = SlowIssuance({
            blockStartedAt: block.number,
            amount: amount,
            baskets: baskets,
            erc20s: basket.backingERC20s(),
            deposits: deposits,
            issuer: _msgSender(),
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
        basketsNeeded = basketsNeeded.plus(baskets);
        rToken().mint(address(rToken()), amount);
    }

    /// Redeem RToken for basket collateral
    /// @param amount {qTok} The quantity {qRToken} of RToken to redeem
    /// @return compensation {qTok} The quantities of collateral tokens transferred out
    function redeem(uint256 amount) public override returns (uint256[] memory compensation) {
        require(amount > 0, "Cannot redeem zero");
        revenueFurnace().melt();

        // {BU} = {BU/rTok} * {qRTok} / {qRTok/rTok}
        Fix baskets = basketsPerRTok().mulu(amount).shiftLeft(-int8(rToken().decimals()));
        emit BasketsNeededSet(basketsNeeded, basketsNeeded.minus(baskets));

        rToken().burn(_msgSender(), amount);

        compensation = basket.withdraw(_msgSender(), baskets);
        emit Redemption(_msgSender(), amount, baskets, basket.backingERC20s(), compensation);

        basketsNeeded = basketsNeeded.minus(baskets);
        assert(basketsNeeded.gte(FIX_ZERO));
    }

    /// @return erc20s The addresses of the ERC20s backing the RToken
    function backingTokens() public view override returns (address[] memory erc20s) {
        return basket.backingERC20s();
    }

    /// @return {qTok} How much RToken `account` can issue given current holdings
    function maxIssuable(address account) external view override returns (uint256) {
        // {qTok} = {BU} / {BU/rTok} * {qRTok/rTok}
        return
            basket
                .balanceOf(account)
                .div(basketsPerRTok())
                .shiftLeft(int8(rToken().decimals()))
                .floor();
    }

    /// @return p {UoA/rTok} The protocol's best guess of the RToken price on markets
    function rTokenPrice() public view override returns (Fix p) {
        // {UoA/rTok} = {UoA/BU} * {BU/rTok}
        return basket.price().mul(basketsPerRTok());
    }

    // Returns the future block number at which an issuance for *amount* now can complete
    function nextIssuanceBlockAvailable(uint256 amount) private view returns (Fix) {
        Fix perBlock = fixMax(
            toFixWithShift(1e4, int8(rToken().decimals())), // at least 10k RTokens per block
            issuanceRate().mulu(rToken().totalSupply())
        ); // {RToken/block}
        Fix blockStart = toFix(block.number);
        if (
            issuances.length > 0 && issuances[issuances.length - 1].blockAvailableAt.gt(blockStart)
        ) {
            blockStart = issuances[issuances.length - 1].blockAvailableAt;
        }
        return blockStart.plus(divFix(amount, perBlock));
    }

    // Process slow issuances:
    // - undoes any issuances that was started before the basket was last set
    // - enacts any other issuances that are fully vested
    function processSlowIssuance() internal {
        bool backingIsSound = worstCollateralStatus() == CollateralStatus.SOUND;
        for (uint256 i = 0; i < issuances.length; i++) {
            SlowIssuance storage iss = issuances[i];
            if (iss.processed) continue;

            if (!backingIsSound || iss.blockStartedAt <= blockBasketLastUpdated) {
                // Rollback issuance i
                rToken().burn(address(rToken()), iss.amount);
                emit BasketsNeededSet(basketsNeeded, basketsNeeded.minus(iss.baskets));

                basketsNeeded = basketsNeeded.minus(iss.baskets);
                assert(basketsNeeded.gte(FIX_ZERO));

                for (uint256 j = 0; j < iss.erc20s.length; j++) {
                    IERC20Metadata(iss.erc20s[j]).safeTransfer(iss.issuer, iss.deposits[j]);
                }
                iss.processed = true;
                emit IssuanceCanceled(i);
            } else if (iss.blockAvailableAt.lte(toFix(block.number))) {
                // Complete issuance i
                rToken().withdraw(iss.issuer, iss.amount);
                iss.processed = true;
                emit IssuanceCompleted(i);
            }
        }
    }
}
