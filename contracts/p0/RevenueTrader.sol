// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/access/Ownable.sol";
import "contracts/p0/libraries/Auction.sol";
import "contracts/p0/interfaces/IERC20Receiver.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/Trader.sol";

contract RevenueTrader is Trader {
    Fate public fate;

    constructor(IVaultHandler main_, Fate fate_) Trader(main_) {
        fate = fate_;
    }

    // TODO: This is all copypasta

    // /// Runs all auctions for revenue
    // function _doRevenueAuctions() internal {
    //     // Empty oldest vault
    //     IVault oldVault = _oldestVault();
    //     if (oldVault != vault) {
    //         oldVault.redeem(address(this), oldVault.basketUnits(address(this)));
    //     }

    //     // RToken -> dividend RSR
    //     (bool launch, Auction.Info memory auction) = _prepareAuctionSell(
    //         minRevenueAuctionSize(),
    //         rTokenAsset(),
    //         rsrAsset(),
    //         rToken().balanceOf(address(this)),
    //         Fate.Stake
    //     );

    //     if (launch) {
    //         _launchAuction(auction);
    //     }

    //     if (cut().eq(FIX_ONE) || cut().eq(FIX_ZERO)) {
    //         // One auction only
    //         IAsset buyAsset = (cut().eq(FIX_ONE)) ? rsrAsset() : rTokenAsset();
    //         Fate fate = (cut().eq(FIX_ONE)) ? Fate.Stake : Fate.Melt;

    //         // COMP -> `buyAsset`
    //         (launch, auction) = _prepareAuctionSell(
    //             minRevenueAuctionSize(),
    //             compAsset(),
    //             buyAsset,
    //             compAsset().erc20().balanceOf(address(this)),
    //             fate
    //         );
    //         if (launch) {
    //             _launchAuction(auction);
    //         }

    //         // AAVE -> `buyAsset`
    //         (launch, auction) = _prepareAuctionSell(
    //             minRevenueAuctionSize(),
    //             aaveAsset(),
    //             buyAsset,
    //             aaveAsset().erc20().balanceOf(address(this)),
    //             fate
    //         );
    //         if (launch) {
    //             _launchAuction(auction);
    //         }
    //     } else {
    //         // Auctions in pairs, sized based on `cut:1-cut`
    //         bool launch2;
    //         Auction.Info memory auction2;

    //         // COMP -> dividend RSR + melting RToken
    //         (launch, launch2, auction, auction2) = _prepareRevenueAuctionPair(compAsset());
    //         if (launch && launch2) {
    //             _launchAuction(auction);
    //             _launchAuction(auction2);
    //         }

    //         // AAVE -> dividend RSR + melting RToken
    //         (launch, launch2, auction, auction2) = _prepareRevenueAuctionPair(aaveAsset());
    //         if (launch && launch2) {
    //             _launchAuction(auction);
    //             _launchAuction(auction2);
    //         }
    //     }
    // }

    // /// Prepares an auction pair for revenue RSR + revenue RToken that is sized `cut:1-cut`
    // /// @return launch Should launch auction 1?
    // /// @return launch2 Should launch auction 2?
    // /// @return auction An auction selling `asset` for RSR, sized `cut`
    // /// @return auction2 An auction selling `asset` for RToken, sized `1-cut`
    // function _prepareRevenueAuctionPair(IAsset asset)
    //     private
    //     returns (
    //         bool launch,
    //         bool launch2,
    //         Auction.Info memory auction,
    //         Auction.Info memory auction2
    //     )
    // {
    //     // Calculate the two auctions without maintaining `cut:1-cut`
    //     Fix bal = toFix(asset.erc20().balanceOf(address(this)));
    //     Fix amountForRSR = bal.mul(cut());
    //     Fix amountForRToken = bal.minus(amountForRSR);

    //     (launch, auction) = _prepareAuctionSell(
    //         minRevenueAuctionSize(),
    //         asset,
    //         rsrAsset(),
    //         amountForRSR.toUint(),
    //         Fate.Stake
    //     );
    //     (launch2, auction2) = _prepareAuctionSell(
    //         minRevenueAuctionSize(),
    //         asset,
    //         rTokenAsset(),
    //         amountForRToken.toUint(),
    //         Fate.Melt
    //     );
    //     if (!launch || !launch2) {
    //         return (false, false, auction, auction2);
    //     }

    //     // Resize the smaller auction to cause the ratio to be `cut:1-cut`
    //     Fix expectedRatio = amountForRSR.div(amountForRToken);
    //     Fix actualRatio = toFix(auction.sellAmount).divu(auction2.sellAmount);
    //     if (actualRatio.lt(expectedRatio)) {
    //         Fix smallerAmountRToken = toFix(auction.sellAmount).mul(FIX_ONE.minus(cut())).div(
    //             cut()
    //         );
    //         (launch2, auction2) = _prepareAuctionSell(
    //             minRevenueAuctionSize(),
    //             asset,
    //             rTokenAsset(),
    //             smallerAmountRToken.toUint(),
    //             Fate.Melt
    //         );
    //     } else if (actualRatio.gt(expectedRatio)) {
    //         Fix smallerAmountRSR = toFix(auction2.sellAmount).mul(cut()).div(FIX_ONE.minus(cut()));
    //         (launch, auction) = _prepareAuctionSell(
    //             minRevenueAuctionSize(),
    //             asset,
    //             rsrAsset(),
    //             smallerAmountRSR.toUint(),
    //             Fate.Stake
    //         );
    //     }
    // }
}
