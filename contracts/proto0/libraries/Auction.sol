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

    struct Info {
        IAsset sellAsset;
        IAsset buyAsset;
        uint256 sellAmount;   // dim: qSellToken
        uint256 minBuyAmount; // dim: qBuyToken
        uint256 startTime;    // dim: seconds since epoch
        uint256 endTime;      // dim: seconds since epoch
        Fate fate;
        bool open;
    }

    function start(
        Auction.Info storage self,
        IAsset sellAsset,
        IAsset buyAsset,
        uint256 sellAmount,
        uint256 minBuyAmount,
        uint256 endTime,
        Fate fate
    ) internal {
        self.sellAsset = sellAsset;
        self.buyAsset = buyAsset;
        self.sellAmount = sellAmount;
        self.minBuyAmount = minBuyAmount;
        self.startTime = block.timestamp;
        self.endTime = endTime;
        self.fate = fate;
        self.open = true;

        // TODO: batchAuction.initiateAuction()
    }

    // Returns the buyAmount for the auction after clearing.
    function process(Auction.Info storage self, IMain main) internal returns (uint256 buyAmount) {
        require(self.open, "already closed out");
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
        self.open = false;
        return buyAmount;
    }

    // Returns false if the auction buyAmount is > *threshold* of the expected buyAmount.
    function clearedCloseToOraclePrice(Auction.Info storage self, IMain main, uint256 buyAmount)
        internal returns (bool) {
        // dim: qBuyToken / qSellToken
        // clearedRate = buyAmount / sellAmount
        Fix clearedRate = toFix(buyAmount).divu(self.sellAmount);

        // dim: (USD/qSellToken lot) / (USD/qBuyToken lot)  =  qBuyToken / qSellToken
        // expectedRate = sellAsset.priceUSD / buyAsset.priceUSD
        Fix expectedRate = (self.sellAsset.priceUSD(main)).div(self.buyAsset.priceUSD(main));

        // return 1 - clearedRate/expectedRate <= auctionClearingTolerance
        return FIX_ONE.minus( (clearedRate).div(expectedRate) ).lte(main.config().auctionClearingTolerance);
    }
}
