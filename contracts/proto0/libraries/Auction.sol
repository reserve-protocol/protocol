// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../interfaces/IAsset.sol";
import "../interfaces/IFurnace.sol";
import "../interfaces/IMain.sol";
import "contracts/libraries/Fixed.sol";

enum Fate {
    Melt, // RToken melting in the furnace
    Stake, // RSR dividend to stRSR
    Burn, // RToken burning
    Stay // No action needs to be taken; tokens can be left at the callers address
}

library Auction {
    using SafeERC20 for IERC20;
    using FixLib for Fix;

    struct Info {
        IAsset sellAsset;
        IAsset buyAsset;
        uint256 sellAmount; // {qTok}
        uint256 minBuyAmount; // {qTok}
        uint256 startTime; // {sec}
        uint256 endTime; // {sec}
        Fate fate;
        bool isOpen;
    }

    function open(Auction.Info storage self) internal {
        // TODO: batchAuction.initiateAuction()
        self.isOpen = true;
    }

    // Returns the buyAmount for the auction after clearing.
    function close(Auction.Info storage self, IMain main) internal returns (uint256 buyAmount) {
        require(self.isOpen, "already closed out");
        require(self.endTime <= block.timestamp, "auction not over");
        // TODO: buyAmount = batchAuction.claim();
        uint256 bal = self.buyAsset.erc20().balanceOf(address(this));

        if (self.fate == Fate.Burn) {
            self.buyAsset.erc20().safeTransfer(address(0), bal);
        } else if (self.fate == Fate.Melt) {
            self.buyAsset.erc20().safeApprove(address(main.furnace()), bal);
            main.furnace().burnOverPeriod(bal, main.config().rewardPeriod);
        } else if (self.fate == Fate.Stake) {
            self.buyAsset.erc20().safeApprove(address(main.stRSR()), bal);
            main.stRSR().addRSR(bal);
        } else if (self.fate == Fate.Stay) {
            // Do nothing; token is already in the right place
        } else {
            assert(false);
        }
        self.isOpen = false;
        return buyAmount;
    }

    // Returns false if the auction buyAmount is > *auctionClearingTolerance* of the expected buyAmount.
    function clearedCloseToOraclePrice(
        Auction.Info storage self,
        IMain main,
        uint256 buyAmount
    ) internal returns (bool) {
        // clearedRate{qBuyTok/qSellTok} = buyAmount{qBuyTok} / sellAmount{qSellTok}
        Fix clearedRate = toFix(buyAmount).divu(self.sellAmount);

        // expectedRate{qBuyTok/qSellTok} = sellAsset.priceUSD{USD/lotSellTok} / buyAsset.priceUSD{USD/lotBuyTok}
        Fix expectedRate = (self.sellAsset.priceUSD(main)).div(self.buyAsset.priceUSD(main));

        // return 1 - clearedRate/expectedRate <= auctionClearingTolerance
        return FIX_ONE.minus((clearedRate).div(expectedRate)).lte(main.config().auctionClearingTolerance);
    }
}
