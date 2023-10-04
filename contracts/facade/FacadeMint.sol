// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/utils/structs/EnumerableMap.sol";
import "../interfaces/IFacadeMint.sol";
import "../interfaces/IRToken.sol";
import "../libraries/Fixed.sol";
import "../p1/BasketHandler.sol";

/**
 * @title FacadeMint
 * @notice A UX-friendly layer for preparing issue/redeem transactions.
 *   Backwards-compatible with 2.1.0 RTokens with the exception of `redeemCustom()`.
 * @custom:static-call - Use ethers callStatic() to get result after update; do not execute
 */
contract FacadeMint is IFacadeMint {
    using FixLib for uint192;
    using EnumerableMap for EnumerableMap.AddressToUintMap;

    // === Static Calls ===

    /// @return {qRTok} How many RToken `account` can issue given current holdings
    /// @custom:static-call
    function maxIssuable(IRToken rToken, address account) external returns (uint256) {
        IMain main = rToken.main();

        require(!main.frozen(), "frozen");

        // Poke Main
        main.assetRegistry().refresh();
        main.furnace().melt();

        // {BU}
        BasketRange memory basketsHeld = main.basketHandler().basketsHeldBy(account);
        uint192 needed = rToken.basketsNeeded();

        int8 decimals = int8(rToken.decimals());

        // return {qRTok} = {BU} * {(1 RToken) qRTok/BU)}
        if (needed.eq(FIX_ZERO)) return basketsHeld.bottom.shiftl_toUint(decimals);

        uint192 totalSupply = shiftl_toFix(rToken.totalSupply(), -decimals); // {rTok}

        // {qRTok} = {BU} * {rTok} / {BU} * {qRTok/rTok}
        return basketsHeld.bottom.mulDiv(totalSupply, needed).shiftl_toUint(decimals);
    }

    /// Do no use inifite approvals.  Instead, use BasketHandler.quote() to determine the amount
    ///     of backing tokens to approve.
    /// @return tokens The erc20 needed for the issuance
    /// @return deposits {qTok} The deposits necessary to issue `amount` RToken
    /// @return depositsUoA {UoA} The UoA value of the deposits necessary to issue `amount` RToken
    /// @custom:static-call
    function issue(IRToken rToken, uint256 amount)
        external
        returns (
            address[] memory tokens,
            uint256[] memory deposits,
            uint192[] memory depositsUoA
        )
    {
        IMain main = rToken.main();
        require(!main.frozen(), "frozen");

        // Cache components
        IRToken rTok = rToken;
        IBasketHandler bh = main.basketHandler();
        IAssetRegistry reg = main.assetRegistry();

        // Poke Main
        reg.refresh();
        main.furnace().melt();

        // Compute # of baskets to create `amount` qRTok
        uint192 baskets = (rTok.totalSupply() > 0) // {BU}
            ? rTok.basketsNeeded().muluDivu(amount, rTok.totalSupply()) // {BU * qRTok / qRTok}
            : _safeWrap(amount); // take advantage of RToken having 18 decimals

        (tokens, deposits) = bh.quote(baskets, CEIL);
        depositsUoA = new uint192[](tokens.length);

        for (uint256 i = 0; i < tokens.length; ++i) {
            IAsset asset = reg.toAsset(IERC20(tokens[i]));
            (uint192 low, uint192 high) = asset.price();
            // untestable:
            //      if high == FIX_MAX then low has to be zero, so this check will not be reached
            if (low == 0 || high == FIX_MAX) continue;

            uint192 mid = (low + high) / 2;

            // {UoA} = {tok} * {UoA/Tok}
            depositsUoA[i] = shiftl_toFix(deposits[i], -int8(asset.erc20Decimals())).mul(mid);
        }
    }

    /// @return tokens The erc20s returned for the redemption
    /// @return withdrawals The balances the reedemer would receive after a full redemption
    /// @return available The amount actually available, for each token
    /// @dev If available[i] < withdrawals[i], then RToken.redeem() would revert
    /// @custom:static-call
    function redeem(IRToken rToken, uint256 amount)
        external
        returns (
            address[] memory tokens,
            uint256[] memory withdrawals,
            uint256[] memory available
        )
    {
        IMain main = rToken.main();
        require(!main.frozen(), "frozen");

        // Cache Components
        IRToken rTok = rToken;
        IBasketHandler bh = main.basketHandler();

        // Poke Main
        main.assetRegistry().refresh();
        main.furnace().melt();

        uint256 supply = rTok.totalSupply();

        // D18{BU} = D18{BU} * {qRTok} / {qRTok}
        uint192 basketsRedeemed = rTok.basketsNeeded().muluDivu(amount, supply);
        (tokens, withdrawals) = bh.quote(basketsRedeemed, FLOOR);
        available = new uint256[](tokens.length);

        // Calculate prorata amounts
        for (uint256 i = 0; i < tokens.length; i++) {
            // {qTok} = {qTok} * {qRTok} / {qRTok}
            available[i] = mulDiv256(
                IERC20(tokens[i]).balanceOf(address(main.backingManager())),
                amount,
                supply
            ); // FLOOR
        }
    }

    /// @return tokens The erc20s returned for the redemption
    /// @return withdrawals The balances received during the redemption
    /// @custom:static-call
    function redeemCustom(
        IRToken rToken,
        uint256 amount,
        uint48[] memory basketNonces,
        uint192[] memory portions
    ) external returns (address[] memory tokens, uint256[] memory withdrawals) {
        IMain main = rToken.main();
        require(!main.frozen(), "frozen");

        // Call collective state keepers.
        main.poke();

        uint256 supply = rToken.totalSupply();

        // === Get basket redemption amounts ===
        uint256 portionsSum;
        for (uint256 i = 0; i < portions.length; ++i) {
            portionsSum += portions[i];
        }
        require(portionsSum == FIX_ONE, "portions do not add up to FIX_ONE");

        // D18{BU} = D18{BU} * {qRTok} / {qRTok}
        uint192 basketsRedeemed = rToken.basketsNeeded().muluDivu(amount, supply);
        (tokens, withdrawals) = main.basketHandler().quoteCustomRedemption(
            basketNonces,
            portions,
            basketsRedeemed
        );

        // ==== Prorate redemption ====
        // Bound each withdrawal by the prorata share, in case currently under-collateralized
        for (uint256 i = 0; i < tokens.length; i++) {
            // {qTok} = {qTok} * {qRTok} / {qRTok}
            uint256 prorata = mulDiv256(
                IERC20(tokens[i]).balanceOf(address(main.backingManager())),
                amount,
                supply
            ); // FLOOR
            if (prorata < withdrawals[i]) withdrawals[i] = prorata;
        }
    }

    // Local-variable of `customRedemptionPortions()`. Should always be empty.
    EnumerableMap.AddressToUintMap private _erc20Bals;

    /// Return the `portions` for a `RToken.redeemCustom()` call that maximizes redemption value
    /// Use `FacadeRead.redeemCustom()` to calculate the expected min amounts out after
    /// Will skip any basket nonces for which any collateral have been unregistered
    /// @param portions {1} The fraction of the custom redemption to pull from each basket nonce
    /// @custom:static-call
    function customRedemptionPortions(RTokenP1 rToken)
        external
        returns (uint192[] memory portions)
    {
        assert(_erc20Bals.length() == 0); // should be empty to start
        rToken.main().poke();

        address bm = address(rToken.main().backingManager());
        BasketHandlerP1 bh = BasketHandlerP1(address(rToken.main().basketHandler()));
        uint48 currentNonce = bh.nonce();

        // Populate `_erc20Bals` with the registered erc20s and their initial balances
        {
            IERC20[] memory erc20s = rToken.main().assetRegistry().erc20s();
            for (uint256 i = 0; i < erc20s.length; i++) {
                _erc20Bals.set(address(erc20s[i]), erc20s[i].balanceOf(bm));
            }
        }

        // Walk backwards from current nonce, deducting from basketsNeeded greedily
        uint192[] memory basketsToUse = new uint192[](currentNonce + 1);
        {
            uint192 basketsNeeded = rToken.basketsNeeded();

            for (uint48 nonce = currentNonce; nonce > 0; nonce--) {
                if (basketsNeeded == 0) continue; // stop searching when we have a full redemption

                (IERC20[] memory erc20s, uint256[] memory quantities) = bh.getHistoricalBasket(
                    nonce
                );

                // Compute basketsToUse[nonce]
                basketsToUse[nonce] = FIX_MAX;
                for (uint256 i = 0; i < erc20s.length; i++) {
                    if (!_erc20Bals.contains(address(erc20s[i]))) {
                        basketsToUse[nonce] = FIX_MAX;
                        break;
                    }

                    if (quantities[i] == 0) continue;

                    (bool success, uint256 availableBal) = _erc20Bals.tryGet(address(erc20s[i]));
                    if (!success) continue;

                    // {BU} = {qTok} / {qTok/BU}
                    uint192 baskets = divuu(availableBal, quantities[i]); // FLOOR
                    if (baskets < basketsToUse[nonce]) basketsToUse[nonce] = baskets;
                }

                // Cap basketsToUse[nonce] and deduct from basketsNeeded
                if (basketsToUse[nonce] == 0 || basketsToUse[nonce] == FIX_MAX) continue;
                if (basketsNeeded < basketsToUse[nonce]) basketsToUse[nonce] = basketsNeeded;
                basketsNeeded -= basketsToUse[nonce];

                // Deduct balances corresponding to basketsToUse[nonce] from _erc20Bals
                for (uint256 i = 0; i < erc20s.length; i++) {
                    (bool success, uint256 availableBal) = _erc20Bals.tryGet(address(erc20s[i]));
                    if (!success) continue;

                    // {qTok} = {BU} * {qTok/BU}
                    uint256 balToUse = basketsToUse[nonce].mul(_safeWrap(quantities[i]), FLOOR);
                    _erc20Bals.set(address(erc20s[i]), availableBal - balToUse);
                }
            }
        }

        // Empty _erc20Bals, just in-case someone accidentally executes this function
        while (_erc20Bals.length() > 0) {
            (address erc20, ) = _erc20Bals.at(_erc20Bals.length() - 1);
            _erc20Bals.remove(erc20);
        }

        return normedArray(basketsToUse);
    }

    // === Private ===

    /// Norm an array, returning a new array that sums to FIX_ONE
    /// @param array {X} An array of any type that needs to be normed
    /// @return normed {1} The normed array; sums to FIX_ONE
    function normedArray(uint192[] memory array) private pure returns (uint192[] memory normed) {
        normed = new uint192[](array.length);

        uint192 arraySum; // {X}
        for (uint256 i = 0; i < array.length; i++) arraySum += array[i];

        uint192 normedSum; // {1}
        for (uint256 i = 0; i < array.length; i++) {
            normed[i] = array[i].div(arraySum); // FLOOR
            normedSum += normed[i];
        }

        // Ensure normed array sums to FIX_ONE; dump into 0th element of array
        if (normedSum < FIX_ONE) normed[0] += FIX_ONE - normedSum;
    }
}
