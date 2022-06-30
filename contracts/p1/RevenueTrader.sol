// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/interfaces/IMain.sol";
import "contracts/interfaces/IAssetRegistry.sol";
import "contracts/p1/mixins/Trading.sol";
import "contracts/p1/mixins/TradingLib.sol";

/// Trader Component that converts all asset balances at its address to a
/// single target asset and sends this asset to the Distributor.
/// @custom:oz-upgrades-unsafe-allow external-library-linking
contract RevenueTraderP1 is TradingP1, IRevenueTrader {
    using FixLib for uint192;

    IERC20 public tokenToBuy;

    function init(
        IMain main_,
        IERC20 tokenToBuy_,
        uint192 maxTradeSlippage_,
        uint192 dustAmount_
    ) external initializer {
        __Component_init(main_);
        __Trading_init(maxTradeSlippage_, dustAmount_);
        tokenToBuy = tokenToBuy_;
    }

    /// Processes a single token; unpermissioned
    /// @dev Intended to be used with multicall
    /// @custom:interaction CEI
    function manageToken(IERC20 erc20) external notPausedOrFrozen {
        if (address(trades[erc20]) != address(0)) return;

        uint256 bal = erc20.balanceOf(address(this));
        if (bal == 0) return;

        if (erc20 == tokenToBuy) {
            // == Interactions then return ==
            IERC20Upgradeable(address(erc20)).approve(address(main.distributor()), bal);
            main.distributor().distribute(erc20, address(this), bal);
            return;
        }

        // If not dust, trade the non-target asset for the target asset
        // Any asset with a broken price feed will trigger a revert here
        IAssetRegistry reg = main.assetRegistry();
        (bool launch, TradeRequest memory trade) = TradingLibP1.prepareTradeSell(
            reg.toAsset(erc20),
            reg.toAsset(tokenToBuy),
            reg.toAsset(erc20).bal(address(this))
        );

        // == Interactions then return ==
        if (launch) tryTrade(trade);
    }
}
