pragma solidity 0.8.9;
// SPDX-License-Identifier: BlueOak-1.0.0

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "contracts/p0/main/SettingsHandler.sol";
import "contracts/p0/main/BasketHandler.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/main/Mixin.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/Pausable.sol";
import "./SettingsHandler.sol";
import "./BasketHandler.sol";

/**
 * @title RTokenIssuer
 * @notice Handles issuance and redemption of RToken.
 */
contract RTokenIssuerP0 is Pausable, Mixin, SettingsHandlerP0, BasketHandlerP0, IRTokenIssuer {
    using FixLib for Fix;
    using SafeERC20 for IERC20Metadata;

    function init(ConstructorArgs calldata args)
        public
        virtual
        override(Mixin, SettingsHandlerP0, BasketHandlerP0)
    {
        super.init(args);
    }

    /// Begin a time-delayed issuance of RToken for basket collateral
    /// @param amount {qTok} The quantity of RToken to issue
    /// @return deposits {qTok} The quantities of collateral tokens transferred in
    function issue(uint256 amount) public override notPaused returns (uint256[] memory deposits) {
        require(amount > 0, "Cannot issue zero");
        revenueFurnace().melt();
        forceCollateralUpdates();
        ensureValidBasket();
        require(worstCollateralStatus() == CollateralStatus.SOUND, "collateral not sound");

        uint256 rTokSupply = rToken().totalSupply(); // {qRTok}
        Fix baskets = (rTokSupply > 0) // {BU}
            ? rToken().basketsNeeded().mulu(amount).divuRound(rTokSupply) // {BU * qRTok / qRTok}
            : toFixWithShift(amount, -int8(rToken().decimals())); // {qRTok / qRTok}

        ICollateral[] memory collateral;
        (collateral, deposits) = basketQuote(baskets, RoundingApproach.CEIL);

        // Transfer collateral to RToken
        for (uint256 i = 0; i < collateral.length; i++) {
            collateral[i].erc20().safeTransferFrom(_msgSender(), address(rToken()), deposits[i]);
        }

        // Begin SlowIssuance
        address[] memory erc20s = new address[](collateral.length);
        for (uint256 i = 0; i < collateral.length; i++) {
            erc20s[i] = address(collateral[i].erc20());
        }
        rToken().issue(_msgSender(), amount, baskets, erc20s, deposits);
        emit IssuanceStarted(_msgSender(), amount, baskets);
    }

    /// Redeem RToken for basket collateral
    /// @param amount {qTok} The quantity {qRToken} of RToken to redeem
    /// @return withdrawals {qTok} The quantities of collateral tokens transferred out
    function redeem(uint256 amount) public override returns (uint256[] memory withdrawals) {
        require(amount > 0, "Cannot redeem zero");
        require(rToken().balanceOf(_msgSender()) >= amount, "not enough RToken");
        revenueFurnace().melt();
        // intentional: no forceCollateralUpdates() or ensureValidBasket()

        // {BU} = {BU} * {qRTok} / {qRTok}
        Fix baskets = rToken().basketsNeeded().mulu(amount).divuRound(rToken().totalSupply());

        ICollateral[] memory collateral;
        (collateral, withdrawals) = basketQuote(baskets, RoundingApproach.FLOOR);

        // {1} = {qRTok} / {qRTok}
        Fix prorate = toFix(amount).divu(rToken().totalSupply());
        rToken().redeem(_msgSender(), amount, baskets);

        // Bound the redemption by the prorata share, in case we're currently under-capitalized
        for (uint256 i = 0; i < collateral.length; i++) {
            // {qTok} = {1} * {qTok}
            uint256 prorata = prorate.mulu(collateral[i].erc20().balanceOf(address(this))).floor();

            withdrawals[i] = Math.min(withdrawals[i], prorata);
            collateral[i].erc20().safeTransfer(_msgSender(), withdrawals[i]);
        }

        emit Redemption(_msgSender(), amount, baskets);
    }

    /// @return collateral The addresses of the ERC20s backing the RToken
    function basketCollateral() public view override returns (ICollateral[] memory collateral) {
        (collateral, ) = basketQuote(FIX_ONE, RoundingApproach.ROUND);
    }

    /// @return {qRTok} How much RToken `account` can issue given current holdings
    function maxIssuable(address account) external view override returns (uint256) {
        Fix needed = rToken().basketsNeeded();
        if (needed.eq(FIX_ZERO)) {
            return basketsHeldBy(account).shiftLeft(int8(rToken().decimals())).floor();
        }

        // {qRTok} = {BU} * {qRTok} / {BU}
        return basketsHeldBy(account).mulu(rToken().totalSupply()).div(needed).floor();
    }

    /// @return p {UoA/rTok} The protocol's best guess of the RToken price on markets
    function rTokenPrice() public view override returns (Fix p) {
        Fix rTokSupply = toFixWithShift(rToken().totalSupply(), -int8(rToken().decimals()));
        if (rTokSupply.eq(FIX_ZERO)) return basketPrice();

        // {UoA/rTok} = {UoA/BU} * {BU} / {rTok}
        return basketPrice().mul(rToken().basketsNeeded()).div(rTokSupply);
    }
}
