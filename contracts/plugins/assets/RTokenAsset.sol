// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/plugins/assets/Asset.sol";
import "contracts/interfaces/IMain.sol";
import "contracts/interfaces/IRToken.sol";

contract RTokenAsset is Asset {
    // solhint-disable no-empty-blocks
    /// @param tradingRange_ {tok} The min and max of the trading range for this asset
    constructor(IRToken rToken_, TradingRange memory tradingRange_)
        Asset(
            AggregatorV3Interface(address(1)),
            IERC20Metadata(address(rToken_)),
            IERC20Metadata(address(0)),
            tradingRange_,
            1
        )
    {}

    // solhint-enable no-empty-blocks

    /// @return p {UoA/rTok} The protocol's best guess of the redemption price of an RToken
    function price() public view override returns (uint192 p) {
        IRToken rToken = IRToken(address(erc20));
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
