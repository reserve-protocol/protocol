pragma solidity 0.8.9;
// SPDX-License-Identifier: BlueOak-1.0.0

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "contracts/p0/main/SettingsHandler.sol";
import "contracts/p0/main/BasketHandler.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/libraries/Basket.sol";
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
    using BasketLib for Basket;
    using FixLib for Fix;

    function init(ConstructorArgs calldata args)
        public
        virtual
        override(Mixin, SettingsHandlerP0, BasketHandlerP0)
    {
        super.init(args);
    }

    function poke() public virtual override(Mixin, BasketHandlerP0) notPaused {
        super.poke();
        revenueFurnace().melt();
        rToken().poke();
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
        Fix baskets = rToken().basketRate().mulu(amount).shiftLeft(-int8(rToken().decimals()));

        // Send collateral to RToken
        deposits = basket.toCollateral(baskets, RoundingApproach.CEIL);
        basket.transferFrom(_msgSender(), address(rToken()), deposits);

        rToken().issueSlowly(_msgSender(), amount, baskets, basket.backingERC20s(), deposits);
        emit IssuanceStarted(_msgSender(), amount, baskets);
    }

    /// Redeem RToken for basket collateral
    /// @param amount {qTok} The quantity {qRToken} of RToken to redeem
    /// @return withdrawals {qTok} The quantities of collateral tokens transferred out
    function redeem(uint256 amount) public override returns (uint256[] memory withdrawals) {
        require(amount > 0, "Cannot redeem zero");
        require(rToken().balanceOf(_msgSender()) >= amount, "not enough RToken");
        revenueFurnace().melt();

        // {BU} = {BU/rTok} * {qRTok} / {qRTok/rTok}
        Fix baskets = rToken().basketRate().mulu(amount).shiftLeft(-int8(rToken().decimals()));
        withdrawals = basket.toCollateral(baskets, RoundingApproach.FLOOR);

        // {none} = {qRTok} / {qRTok}
        Fix prorate = toFix(amount).divu(rToken().totalSupply());
        rToken().redeem(_msgSender(), amount, baskets);

        // Bound the redemption by the prorata share
        for (uint256 i = 0; i < withdrawals.length; i++) {
            // {qTok} = {none} * {qTok}
            uint256 prorata = prorate
                .mulu(basket.collateral[i].erc20().balanceOf(address(this)))
                .floor();

            withdrawals[i] = Math.min(withdrawals[i], prorata);
        }

        basket.transfer(_msgSender(), withdrawals);
        emit Redemption(_msgSender(), amount, baskets);
    }

    /// @return erc20s The addresses of the ERC20s backing the RToken
    function backingTokens() public view override returns (address[] memory erc20s) {
        return basket.backingERC20s();
    }

    /// @return {qTok} How much RToken `account` can issue given current holdings
    function maxIssuable(address account) external view override returns (uint256) {
        // {qTok} = {BU} * {qRTok/rTok} / {BU/rTok}
        return
            basket
                .balanceOf(account)
                .shiftLeft(int8(rToken().decimals()))
                .div(rToken().basketRate())
                .floor();
    }

    /// @return p {UoA/rTok} The protocol's best guess of the RToken price on markets
    function rTokenPrice() public view override returns (Fix p) {
        // {UoA/rTok} = {UoA/BU} * {BU/rTok}
        return basket.price().mul(rToken().basketRate());
    }
}
