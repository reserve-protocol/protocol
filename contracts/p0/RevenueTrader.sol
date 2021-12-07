// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/p0/interfaces/IERC20Receiver.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/Trader.sol";
import "contracts/p0/main/VaultHandler.sol";

/// The RevenueTrader converts all asset balances at its address to a single target asset,
/// and transfers this to either the Furnace or StRSR.
contract RevenueTraderP0 is TraderP0 {
    using SafeERC20 for IERC20;

    IAsset private assetToBuy;

    constructor(IMain main_, IAsset assetToBuy_) TraderP0(main_) {
        assetToBuy = assetToBuy_;
    }

    function poke() public override returns (bool) {
        // Always process auctions *and* do funds management; don't short-circuit here.
        bool openAuctions = TraderP0.closeDueAuctions();
        bool launchedNewAuction = _manageFunds();
        return openAuctions || launchedNewAuction;
    }

    /// Iterate through all asset types, and perform the appropriate action with each:
    /// - If we have any of `assetToBuy` (RSR or RToken), distribute it.
    /// - If we have any of any other asset, start an auction to sell it for `assetToBuy`
    /// @return trading Whether an auction was launched

    function _manageFunds() private returns (bool trading) {
        IAsset[] memory assets = main.allAssets(); // includes RToken/RSR/COMP/AAVE
        trading = false;
        for (uint256 i = 0; i < assets.length; i++) {
            IERC20 erc20 = assets[i].erc20();
            uint256 bal = erc20.balanceOf(address(this));

            if (assets[i] == assetToBuy && bal > 0) {
                erc20.safeApprove(address(main), bal);
                main.distribute(erc20, address(this), bal);
            } else {
                // If not dust, trade the non-target asset for the target asset
                bool launch;
                Auction memory auction;

                (launch, auction) = _prepareAuctionSell(assets[i], assetToBuy, bal);
                if (launch) {
                    trading = true;
                    _launchAuction(auction);
                }
            }
        }
    }
}
