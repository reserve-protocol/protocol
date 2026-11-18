// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "../interfaces/IRToken.sol";
import "../libraries/Fixed.sol";
import "../p1/BasketHandler.sol";
import "../p1/BackingManager.sol";

contract FacadeRedeem {
    function getBaseInformation(IRToken rToken)
        external
        returns (
            uint48 currentNonce,
            uint192 basketsNeeded,
            IERC20[] memory allErc20s,
            uint256[] memory allBalances,
            IERC20[][] memory erc20s,
            uint256[][] memory quantities
        )
    {
        // Either hell freezes over, or it's a static call.
        require(msg.sender == address(0), unicode"ಠ_ಠ");

        rToken.main().poke();

        BackingManagerP1 bm = BackingManagerP1(address(rToken.main().backingManager()));
        BasketHandlerP1 bh = BasketHandlerP1(address(rToken.main().basketHandler()));

        currentNonce = bh.nonce();
        basketsNeeded = rToken.basketsNeeded();

        allErc20s = rToken.main().assetRegistry().erc20s();
        allBalances = new uint256[](allErc20s.length);

        for (uint256 i = 0; i < allErc20s.length; ++i) {
            allBalances[i] = allErc20s[i].balanceOf(address(bm));
        }

        quantities = new uint256[][](currentNonce);
        erc20s = new IERC20[][](currentNonce);

        for (uint48 nonce = 1; nonce <= currentNonce; nonce++) {
            (IERC20[] memory erc20ForNonce, uint256[] memory qtys) = bh.getHistoricalBasket(nonce);

            quantities[nonce - 1] = qtys;
            erc20s[nonce - 1] = erc20ForNonce;
        }
    }
}
