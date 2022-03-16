// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/interfaces/IAsset.sol";
import "contracts/interfaces/IAssetRegistry.sol";
import "contracts/interfaces/IMain.sol";
import "contracts/libraries/Fixed.sol";

/**
 * @title TradingLibP0
 * @notice
 */
library TradingLibP0 {
    using FixLib for int192;

    // Compute max surpluse relative to basketTop and max deficit relative to basketBottom
    /// @return surplus Surplus asset OR address(0)
    /// @return deficit Deficit collateral OR address(0)
    /// @return sellAmount {sellTok} Surplus amount (whole tokens)
    /// @return buyAmount {buyTok} Deficit amount (whole tokens)
    function largestSurplusAndDeficit(
        IMain main,
        int192 maxTradeSlippage,
        bool pickTarget
    )
        external
        view
        returns (
            IAsset surplus,
            ICollateral deficit,
            int192 sellAmount,
            int192 buyAmount
        )
    {
        IERC20[] memory erc20s = main.assetRegistry().erc20s();

        // Compute basketTop and basketBottom
        // basketTop is the lowest number of BUs to which we'll try to sell surplus assets
        // basketBottom is the greatest number of BUs to which we'll try to buy deficit assets
        int192 basketTop = main.rToken().basketsNeeded(); // {BU}
        int192 basketBottom = basketTop;

        if (pickTarget) {
            int192 tradeVolume;
            int192 totalValue;
            for (uint256 i = 0; i < erc20s.length; i++) {
                IAsset asset = main.assetRegistry().toAsset(erc20s[i]);
                totalValue = totalValue.plus(asset.bal(address(this)).mul(asset.price()));
            }
            basketTop = totalValue.div(main.basketHandler().price());

            for (uint256 i = 0; i < erc20s.length; i++) {
                IAsset asset = main.assetRegistry().toAsset(erc20s[i]);
                if (!asset.isCollateral()) continue;
                int192 needed = basketTop.mul(main.basketHandler().quantity(erc20s[i]));
                int192 held = asset.bal(address(this));

                if (held.lt(needed)) {
                    tradeVolume = tradeVolume.plus(needed.minus(held).mul(asset.price()));
                }
            }

            // two-line calculation to save stack vars
            basketBottom = maxTradeSlippage.mul(tradeVolume).div(totalValue);
            basketBottom = basketTop.mul(FIX_ONE.minus(basketBottom)); // {BU}
        }

        int192 max; // {UoA} positive!
        int192 min; // {UoA} negative!
        for (uint256 i = 0; i < erc20s.length; i++) {
            IAsset asset = main.assetRegistry().toAsset(erc20s[i]);
            int192 needed; // {tok}

            // The below code is organized weirdly in order to fit under the stack limit,
            // which we are right up against.

            // Surplus case
            if (asset.isCollateral()) {
                needed = basketTop.mul(main.basketHandler().quantity(erc20s[i]));
            }
            if (asset.bal(address(this)).gt(needed)) {
                int192 delta = asset.bal(address(this)).minus(needed).mul(asset.price());
                if (delta.gt(max)) {
                    surplus = asset;
                    max = delta;
                    sellAmount = max.div(surplus.price());
                }
            }

            // Deficit case
            needed = asset.isCollateral()
                ? basketBottom.mul(main.basketHandler().quantity(erc20s[i]))
                : FIX_ZERO;

            if (asset.bal(address(this)).lt(needed)) {
                int192 delta = asset.bal(address(this)).minus(needed).mul(asset.price());
                if (delta.lt(min)) {
                    deficit = ICollateral(address(asset));
                    min = delta;
                    buyAmount = min.minus(min).minus(min).div(deficit.price());
                }
            }
        }
    }
}
