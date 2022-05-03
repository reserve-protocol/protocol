// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/interfaces/IMain.sol";
import "contracts/interfaces/IAssetRegistry.sol";
import "contracts/p1/mixins/Trading.sol";
import "contracts/p1/mixins/TradingLib.sol";

/// Trader Component that converts all asset balances at its address to a
/// single target asset and sends this asset to the Distributor.
/// @custom:oz-upgrades-unsafe-allow external-library-linking
contract RevenueTradingP1 is TradingP1, IRevenueTrader {
    using FixLib for int192;
    using SafeERC20Upgradeable for IERC20Upgradeable;

    IERC20 public tokenToBuy;

    function init(
        IMain main_,
        IERC20 tokenToBuy_,
        int192 maxTradeSlippage_,
        int192 dustAmount_
    ) external initializer {
        __Component_init(main_);
        __Trading_init(maxTradeSlippage_, dustAmount_);
        tokenToBuy = tokenToBuy_;
    }

    /// Close any open trades and start new ones, for all assets
    /// Collective Action
    function manageFunds() external notPaused {
        // Call state keepers
        main.assetRegistry().forceUpdates();
        settleTrades();

        // Do not trade when DISABLED or IFFY
        require(main.basketHandler().status() == CollateralStatus.SOUND, "basket defaulted");

        IERC20[] memory erc20s = main.assetRegistry().erc20s();
        for (uint256 i = 0; i < erc20s.length; i++) {
            manageERC20(erc20s[i]);
        }
    }

    /// - If we have any of `tokenToBuy` (RSR or RToken), distribute it.
    /// - If we have any of any other asset, start an trade to sell it for `assetToBuy`
    function manageERC20(IERC20 erc20) internal {
        IAssetRegistry reg = main.assetRegistry();

        uint256 bal = erc20.balanceOf(address(this));
        if (bal == 0) return;

        if (erc20 == tokenToBuy) {
            IERC20Upgradeable(address(erc20)).safeIncreaseAllowance(
                address(main.distributor()),
                bal
            );
            main.distributor().distribute(erc20, address(this), bal);
            return;
        }

        // Don't open a second trade if there's already one running.
        uint256 tradesLength = trades.length;
        for (uint256 i = tradesStart; i < tradesLength; ++i) {
            if (trades[i].sell() == erc20) return;
        }

        // If not dust, trade the non-target asset for the target asset
        (bool launch, TradeRequest memory trade) = TradingLibP1.prepareTradeSell(
            reg.toAsset(erc20),
            reg.toAsset(tokenToBuy),
            reg.toAsset(erc20).bal(address(this))
        );

        if (launch) tryTrade(trade);
    }
}
