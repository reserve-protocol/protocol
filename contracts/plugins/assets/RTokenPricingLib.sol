// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "contracts/interfaces/IAssetRegistry.sol";
import "contracts/interfaces/IRToken.sol";

library RTokenPricingLib {
    function price(IRToken rToken) internal view returns (uint192 p) {
        IMain main = rToken.main();
        uint256 totalSupply = rToken.totalSupply();
        uint256 basketsNeeded = rToken.basketsNeeded();
        require(totalSupply > 0, "no supply");

        // downcast is safe: basketsNeeded is <= 1e39
        // D18{BU} = D18{BU} * D18{rTok} / D18{rTok}
        uint192 amtBUs = uint192((basketsNeeded * FIX_ONE_256) / totalSupply);
        (address[] memory erc20s, uint256[] memory quantities) = main.basketHandler().quote(
            amtBUs,
            FLOOR
        );

        uint256 erc20length = erc20s.length;
        address backingMgr = address(main.backingManager());
        IAssetRegistry assetRegistry = main.assetRegistry();

        // Bound each withdrawal by the prorata share, in case we're currently under-capitalized
        for (uint256 i = 0; i < erc20length; ++i) {
            IAsset asset = assetRegistry.toAsset(IERC20(erc20s[i]));

            // {qTok} =  {qRTok} * {qTok} / {qRTok}
            uint256 prorated = (FIX_ONE_256 * IERC20(erc20s[i]).balanceOf(backingMgr)) /
                (totalSupply);

            if (prorated < quantities[i]) quantities[i] = prorated;

            // D18{tok} = D18 * {qTok} / {qTok/tok}
            uint192 q = shiftl_toFix(quantities[i], -int8(IERC20Metadata(erc20s[i]).decimals()));

            // downcast is safe: total attoUoA from any single asset is well under 1e47
            // D18{UoA} = D18{UoA} + (D18{UoA/tok} * D18{tok} / D18
            p += uint192((asset.price() * uint256(q)) / FIX_ONE);
        }
    }
}
