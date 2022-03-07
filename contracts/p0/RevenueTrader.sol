// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "contracts/interfaces/IMain.sol";
import "contracts/interfaces/IAssetRegistry.sol";
import "contracts/p0/Trader.sol";

/// The RevenueTrader converts all asset balances at its address to a single target asset
/// and sends this asset to the Distributor.
contract RevenueTraderP0 is TraderP0, IRevenueTrader {
    using SafeERC20 for IERC20;

    IERC20 public immutable tokenToBuy;

    constructor(IERC20 tokenToBuy_) TraderP0() {
        tokenToBuy = tokenToBuy_;
    }

    /// Close any open auctions and start new ones, for all assets
    /// Collective Action
    function manageFunds() external {
        // Call state keepers
        main.poke();

        IERC20[] memory erc20s = main.assetRegistry().erc20s();
        for (uint256 i = 0; i < erc20s.length; i++) {
            manageERC20(erc20s[i]);
        }
    }

    /// - If we have any of `tokenToBuy` (RSR or RToken), distribute it.
    /// - If we have any of any other asset, start an auction to sell it for `assetToBuy`
    function manageERC20(IERC20 erc20) internal {
        IAssetRegistry reg = main.assetRegistry();

        require(reg.isRegistered(erc20), "erc20 not registered");

        closeDueAuctions();

        uint256 bal = erc20.balanceOf(address(this));
        if (bal == 0) return;

        if (erc20 == tokenToBuy) {
            erc20.safeApprove(address(main.distributor()), bal);
            main.distributor().distribute(erc20, address(this), bal);
            return;
        }

        // Don't open a second auction if there's already one running.
        for (uint256 i = 0; i < auctions.length; i++) {
            if (auctions[i].sell == erc20 && auctions[i].status != AuctionStatus.DONE) return;
        }

        // If not dust, trade the non-target asset for the target asset
        // {tok} =  {qTok} / {qTok/tok}
        Fix sellAmount = reg.toAsset(erc20).fromQ(toFix(bal));
        (bool launch, Auction memory auction) = prepareAuctionSell(
            reg.toAsset(erc20),
            reg.toAsset(tokenToBuy),
            sellAmount
        );

        if (launch) launchAuction(auction);
    }
}
