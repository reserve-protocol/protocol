// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.28;

import "../p1/mixins/BasketLib.sol";
import "../p1/BasketHandler.sol";
import "../p1/Main.sol";
import "../interfaces/IDeployer.sol";
import "../interfaces/IMain.sol";
import "../p1/Deployer.sol";

/**
 * This spell is used by reweightable RTokens with rev 4.0.0 or later.
 *
 * This allows governance to normalize the basket by price at the time of setting it in place,
 * effectively allowing for a basket that is continous in USD terms.
 *
 * Before casting `setNormalizedBasket` function this contract must have `MAIN_OWNER_ROLE` of Main,
 * and should also revoke the said role at the end of the transaction.
 *
 * The spell function should be called by the timelock owning Main. Governance should NOT
 * grant this spell ownership without immediately executing the spell function after.
 */
contract SpellBasketNormalizer {
    function setNormalizedBasket(
        IRToken rToken,
        IERC20[] calldata erc20s,
        uint192[] calldata targetAmts
    ) external {
        require(erc20s.length == targetAmts.length, "SBN: mismatch");

        MainP1 main = MainP1(address(rToken.main()));
        IAssetRegistry assetRegistry = main.assetRegistry();
        IBasketHandler basketHandler = main.basketHandler();

        require(BasketHandlerP1(address(basketHandler)).reweightable(), "SBN: reweightable");

        assetRegistry.refresh();
        (uint192 low, uint192 high) = basketHandler.price(false);

        uint192[] memory newTargetAmts = BasketLibP1.normalizeByPrice(
            assetRegistry,
            erc20s,
            targetAmts,
            (low + high + 1) / 2
        );

        basketHandler.forceSetPrimeBasket(erc20s, newTargetAmts);

        main.revokeRole(main.OWNER_ROLE(), address(this));
    }
}
