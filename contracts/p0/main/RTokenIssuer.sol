pragma solidity 0.8.9;
// SPDX-License-Identifier: BlueOak-1.0.0

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/Component.sol";
// import "contracts/p0/interfaces/ISettingsHandler.sol";
// import "contracts/p0/interfaces/IBasketHandler.sol";

import "contracts/libraries/Fixed.sol";
import "contracts/Pausable.sol";

/**
 * @title RTokenIssuer
 * @notice Handles issuance and redemption of RToken.
 */
contract RTokenIssuerP0 is IRTokenIssuer, Component {
    using FixLib for Fix;
    using SafeERC20 for IERC20Metadata;

    /// Begin a time-delayed issuance of RToken for basket collateral
    /// @param amount {qTok} The quantity of RToken to issue
    /// @return deposits {qTok} The quantities of collateral tokens transferred in
    function issue(uint256 amount) public override notPaused returns (uint256[] memory deposits) {
        require(amount > 0, "Cannot issue zero");
        main.revenueFurnace().melt();
        main.forceCollateralUpdates();
        main.ensureValidBasket();

        IRToken rToken = main.rToken();

        require(main.worstCollateralStatus() == CollateralStatus.SOUND, "collateral not sound");

        uint256 rTokSupply = rToken.totalSupply(); // {qRTok}
        Fix baskets = (rTokSupply > 0) // {BU}
            ? rToken.basketsNeeded().mulu(amount).divuRound(rTokSupply) // {BU * qRTok / qRTok}
            : toFixWithShift(amount, -int8(rToken.decimals())); // {qRTok / qRTok}

        IERC20Metadata[] memory erc20s;
        (erc20s, deposits) = main.basketQuote(baskets, RoundingApproach.CEIL);

        // Transfer collateral to RToken
        for (uint256 i = 0; i < erc20s.length; i++) {
            erc20s[i].safeTransferFrom(_msgSender(), address(rToken), deposits[i]);
        }

        rToken.issue(_msgSender(), amount, baskets, erc20s, deposits);
        emit IssuanceStarted(_msgSender(), amount, baskets);
    }

    /// Redeem RToken for basket collateral
    /// @param amount {qTok} The quantity {qRToken} of RToken to redeem
    /// @return withdrawals {qTok} The quantities of collateral tokens transferred out
    function redeem(uint256 amount) public override returns (uint256[] memory withdrawals) {
        require(amount > 0, "Cannot redeem zero");
        IRToken rToken = main.rToken();

        require(rToken.balanceOf(_msgSender()) >= amount, "not enough RToken");
        main.revenueFurnace().melt();
        // intentional: no forceCollateralUpdates() or ensureValidBasket()

        // {BU} = {BU} * {qRTok} / {qRTok}
        Fix baskets = rToken.basketsNeeded().mulu(amount).divuRound(rToken.totalSupply());

        IERC20Metadata[] memory erc20s;
        (erc20s, withdrawals) = main.basketQuote(baskets, RoundingApproach.FLOOR);

        // {1} = {qRTok} / {qRTok}
        Fix prorate = toFix(amount).divu(rToken.totalSupply());
        rToken.redeem(_msgSender(), amount, baskets);

        // Bound the redemption by the prorata share, in case we're currently under-capitalized
        for (uint256 i = 0; i < erc20s.length; i++) {
            // {qTok} = {1} * {qTok}
            uint256 prorata = prorate.mulu(erc20s[i].balanceOf(address(main))).floor();

            withdrawals[i] = Math.min(withdrawals[i], prorata);
            erc20s[i].safeTransfer(_msgSender(), withdrawals[i]);
        }

        emit Redemption(_msgSender(), amount, baskets);
    }

    /// @return tokens The addresses of the ERC20s backing the RToken
    function basketTokens() public view override returns (IERC20Metadata[] memory tokens) {
        (tokens, ) = main.basketQuote(FIX_ONE, RoundingApproach.ROUND);
    }

    /// @return {qRTok} How much RToken `account` can issue given current holdings
    function maxIssuable(address account) external view override returns (uint256) {
        Fix needed = main.rToken().basketsNeeded();
        Fix held = main.basketsHeldBy(account);

        if (needed.eq(FIX_ZERO)) return held.shiftLeft(int8(main.rToken().decimals())).floor();

        // {qRTok} = {BU} * {qRTok} / {BU}
        return held.mulu(main.rToken().totalSupply()).div(needed).floor();
    }

    /// @return p {UoA/rTok} The protocol's best guess of the RToken price on markets
    function rTokenPrice() external view override returns (Fix p) {
        IRToken rToken = main.rToken();
        Fix rTokSupply = toFixWithShift(rToken.totalSupply(), -int8(rToken.decimals()));
        if (rTokSupply.eq(FIX_ZERO)) return main.basketPrice();

        // {UoA/rTok} = {UoA/BU} * {BU} / {rTok}
        return main.basketPrice().mul(rToken.basketsNeeded()).div(rTokSupply);
    }
}
