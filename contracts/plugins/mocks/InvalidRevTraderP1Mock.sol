// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../../interfaces/IMain.sol";
import "../../interfaces/IAssetRegistry.sol";
import "../../p1/mixins/Trading.sol";
import "../../p1/mixins/TradeLib.sol";

/// Trader Component that reverts on manageToken
contract RevenueTraderP1InvalidReverts is TradingP1, IRevenueTrader {
    using FixLib for uint192;
    using SafeERC20 for IERC20;

    // Immutable after init()
    IERC20 public tokenToBuy;
    IAssetRegistry private assetRegistry;
    IDistributor private distributor;
    IBackingManager private backingManager;
    IFurnace private furnace;
    IRToken private rToken;
    IERC20 private rsr;

    function init(
        IMain main_,
        IERC20 tokenToBuy_,
        uint192 maxTradeSlippage_,
        uint192 minTradeVolume_
    ) external initializer {
        require(address(tokenToBuy_) != address(0), "invalid token address");
        __Component_init(main_);
        __Trading_init(main_, maxTradeSlippage_, minTradeVolume_);
        tokenToBuy = tokenToBuy_;
        cacheComponents();
    }

    /// Distribute tokenToBuy to its destinations
    function distributeTokenToBuy() public notTradingPausedOrFrozen {
        uint256 bal = tokenToBuy.balanceOf(address(this));
        tokenToBuy.safeApprove(address(main.distributor()), 0);
        tokenToBuy.safeApprove(address(main.distributor()), bal);
        main.distributor().distribute(tokenToBuy, bal);
    }

    /// Return registered ERC20s to the BackingManager if distribution for tokenToBuy is 0
    /// @custom:interaction
    function returnTokens(IERC20[] memory erc20s) external notTradingPausedOrFrozen {
        RevenueTotals memory revTotals = distributor.totals();
        if (tokenToBuy == rsr) {
            require(revTotals.rsrTotal == 0, "rsrTotal > 0");
        } else if (address(tokenToBuy) == address(rToken)) {
            require(revTotals.rTokenTotal == 0, "rTokenTotal > 0");
        } else {
            revert("invalid tokenToBuy");
        }

        // Return ERC20s to the BackingManager
        uint256 len = erc20s.length;
        for (uint256 i = 0; i < len; ++i) {
            require(assetRegistry.isRegistered(erc20s[i]), "erc20 unregistered");
            erc20s[i].safeTransfer(address(backingManager), erc20s[i].balanceOf(address(this)));
        }
    }

    /// Processes a single token; unpermissioned
    /// Reverts for testing purposes
    function manageTokens(IERC20[] memory, TradeKind[] memory) external notTradingPausedOrFrozen {
        rToken = rToken; // silence warning
        revert();
    }

    function cacheComponents() public {
        assetRegistry = main.assetRegistry();
        distributor = main.distributor();
        backingManager = main.backingManager();
        furnace = main.furnace();
        rToken = main.rToken();
        rsr = main.rsr();
    }
}
