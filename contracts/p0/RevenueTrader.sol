// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/interfaces/IMain.sol";
import "contracts/interfaces/IAssetRegistry.sol";
import "contracts/p0/mixins/Trading.sol";
import "contracts/p0/mixins/TradingLib.sol";

/// Trader Component that converts all asset balances at its address to a
/// single target asset and sends this asset to the Distributor.
contract RevenueTraderP0 is TradingP0, IRevenueTrader {
    using FixLib for uint192;
    using SafeERC20 for IERC20;

    IERC20 public tokenToBuy;

    function init(
        IMain main_,
        IERC20 tokenToBuy_,
        uint192 maxTradeSlippage_,
        uint192 minTradeVolume_
    ) public initializer {
        require(address(tokenToBuy_) != address(0), "invalid token address");
        __Component_init(main_);
        __Trading_init(maxTradeSlippage_, minTradeVolume_);
        tokenToBuy = tokenToBuy_;
    }

    /// Processes a single token; unpermissioned
    /// @dev Intended to be used with multicall
    /// @custom:interaction
    function manageToken(IERC20 erc20) external notPausedOrFrozen {
        if (address(trades[erc20]) != address(0)) return;

        uint256 bal = erc20.balanceOf(address(this));
        if (bal == 0) return;

        if (erc20 == tokenToBuy) { 
            erc20.safeApprove(address(main.distributor()), 0);
            erc20.safeApprove(address(main.distributor()), bal);
            main.distributor().distribute(erc20, address(this), bal);
            return;
        }

        IAssetRegistry reg = main.assetRegistry();
        IAsset sell = reg.toAsset(erc20);
        IAsset buy = reg.toAsset(tokenToBuy);
        uint192 sellPrice = sell.strictPrice(); // {UoA/tok}
        uint192 buyPrice = buy.strictPrice(); // {UoA/tok}

        require(buyPrice > 0, "buy asset has zero price");

        // If not dust, trade the non-target asset for the target asset
        // Any asset with a broken price feed will trigger a revert here
        (bool launch, TradeRequest memory trade) = TradingLibP0.prepareTradeSell(
            this,
            sell,
            buy,
            sell.bal(address(this)),
            sellPrice,
            buyPrice
        );

        if (launch) {
            if (sell.isCollateral()) {
                CollateralStatus status = ICollateral(address(sell)).status();

                if (status == CollateralStatus.IFFY) return;
                if (status == CollateralStatus.DISABLED) trade.minBuyAmount = 0;
            }

            tryTrade(trade);
        }
    }
}
