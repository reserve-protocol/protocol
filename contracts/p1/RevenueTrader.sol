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
contract RevenueTraderP1 is TradingP1, IRevenueTrader {
    using FixLib for int192;
    using SafeERC20Upgradeable for IERC20Upgradeable;

    IERC20 public tokenToBuy;

    uint32 public maxPriceLatency; // {s} how out of date revenue trader permits prices to be

    function init(
        IMain main_,
        IERC20 tokenToBuy_,
        int192 maxTradeSlippage_,
        int192 dustAmount_,
        uint32 maxPriceLatency_
    ) external initializer {
        __Component_init(main_);
        __Trading_init(maxTradeSlippage_, dustAmount_);
        tokenToBuy = tokenToBuy_;
        maxPriceLatency = maxPriceLatency_;
    }

    /// Processes a single token; unpermissioned
    /// @dev Intended to be used with multicall
    /// @custom:action
    function processToken(IERC20 erc20) external notPaused {
        if (address(trades[erc20]) != address(0)) return;

        IAssetRegistry reg = main.assetRegistry();
        if (block.timestamp - reg.lastForceUpdates() > maxPriceLatency) reg.forceUpdates();

        uint256 bal = erc20.balanceOf(address(this));
        if (bal == 0) return;

        if (erc20 == tokenToBuy) {
            IERC20Upgradeable(address(erc20)).approve(address(main.distributor()), bal);
            main.distributor().distribute(erc20, address(this), bal);
            return;
        }

        // If not dust, trade the non-target asset for the target asset
        (bool launch, TradeRequest memory trade) = TradingLibP1.prepareTradeSell(
            reg.toAsset(erc20),
            reg.toAsset(tokenToBuy),
            reg.toAsset(erc20).bal(address(this))
        );

        if (launch) tryTrade(trade);
    }

    // === Setter ===

    function setMaxPriceLatency(uint32 maxPriceLatency_) external onlyOwner {
        emit MaxPriceLatencySet(maxPriceLatency, maxPriceLatency_);
        maxPriceLatency = maxPriceLatency_;
    }
}
