// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../../interfaces/IBasketHandler.sol";
import "../../interfaces/IRToken.sol";
import "../../libraries/Fixed.sol";
import "../../p1/BasketHandler.sol";

/**
 * @title MaxIssuableFacet
 * @notice
 *   Two-function facet for Facade
 * @custom:static-call - Use ethers callStatic() to get result after update; do not execute
 */
// slither-disable-start
contract MaxIssuableFacet {
    using FixLib for uint192;

    // === Static Calls ===

    /// @return {qRTok} How many RToken `account` can issue given current holdings
    /// @custom:static-call
    function maxIssuable(IRToken rToken, address account) external returns (uint256) {
        BasketHandlerP1 bh = BasketHandlerP1(address(rToken.main().basketHandler()));
        (address[] memory erc20s, ) = bh.quote(FIX_ONE, FLOOR);
        uint256[] memory balances = new uint256[](erc20s.length);
        for (uint256 i = 0; i < erc20s.length; ++i) {
            balances[i] = IERC20(erc20s[i]).balanceOf(account);
        }
        return maxIssuableByAmounts(rToken, balances);
    }

    /// @param amounts {qTok} Amounts per basket ERC20
    ///                       Assumes same order as current basket ERC20s given by bh.quote()
    /// @return {qRTok} How many RToken `account` can issue given current holdings
    /// @custom:static-call
    function maxIssuableByAmounts(IRToken rToken, uint256[] memory amounts)
        public
        returns (uint256)
    {
        IMain main = rToken.main();

        require(!main.frozen(), "frozen");

        // Poke Main
        main.assetRegistry().refresh();

        // Get basket ERC20s
        BasketHandlerP1 bh = BasketHandlerP1(address(main.basketHandler()));
        (address[] memory erc20s, uint256[] memory quantities) = bh.quote(FIX_ONE, CEIL);

        // Compute how many baskets we can mint with the collateral amounts
        uint192 baskets = type(uint192).max;
        for (uint256 i = 0; i < erc20s.length; ++i) {
            // {BU} = {tok} / {tok/BU}
            uint192 inBUs = divuu(amounts[i], quantities[i]); // FLOOR
            baskets = fixMin(baskets, inBUs);
        }

        // Convert baskets to RToken
        // {qRTok} = {BU} * {qRTok} / {BU}
        uint256 totalSupply = rToken.totalSupply();
        if (totalSupply == 0) return baskets;
        return baskets.muluDivu(rToken.totalSupply(), rToken.basketsNeeded(), FLOOR);
    }
}
// slither-disable-end
