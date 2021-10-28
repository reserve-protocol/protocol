// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../interfaces/IAsset.sol";
import "../interfaces/IFurnace.sol";
import "../interfaces/IMain.sol";

library Auction {
    using SafeERC20 for IERC20;

    struct Info {
        IAsset sellAsset;
        IAsset buyAsset;
        uint256 sellAmount;
        uint256 minBuyAmount;
        uint256 startTime;
        uint256 endTime;
        address destination;
        bool open;
    }

    function start(
        Auction.Info storage self,
        IAsset sellAsset,
        IAsset buyAsset,
        uint256 sellAmount,
        uint256 minBuyAmount,
        uint256 endTime,
        address destination
    ) internal {
        self.sellAsset = sellAsset;
        self.buyAsset = buyAsset;
        self.sellAmount = sellAmount;
        self.minBuyAmount = minBuyAmount;
        self.startTime = block.timestamp;
        self.endTime = endTime;
        self.destination = destination;
        self.open = true;

        // TODO: batchAuction.initiateAuction()
    }

    // Returns the buyAmount for the auction after clearing.
    function process(Auction.Info storage self, IMain main) internal returns (uint256 buyAmount) {
        require(self.open, "already closed out");
        require(self.endTime <= block.timestamp, "auction not over");
        // TODO: buyAmount = batchAuction.claim();
        uint256 bal = self.buyAsset.erc20().balanceOf(address(this));
        self.buyAsset.erc20().safeApprove(self.destination, bal);

        if (self.destination == address(0)) {
            // burn
            self.buyAsset.erc20().safeTransfer(address(0), bal);
        } else if (self.destination == address(main.furnace())) {
            // melt
            main.furnace().burnOverPeriod(bal, main.config().rewardPeriod);
        } else if (self.destination == address(main.staking())) {
            // addRSR
            main.staking().addRSR(bal);
        }
        self.open = false;
        return buyAmount;
    }

    // Returns false if the auction buyAmount is > *threshold* of the expected buyAmount.
    function clearedCloseToOraclePrice(
        Auction.Info storage self,
        IMain main,
        uint256 buyAmount
    ) internal returns (bool) {
        uint256 SCALE = main.SCALE();
        uint256 sellAmountNormalized = (self.sellAmount * SCALE) / 10**(self.sellAsset.decimals());
        uint256 buyAmountNormalized = (buyAmount * SCALE) / 10**(self.buyAsset.decimals());
        uint256 ratio = (buyAmountNormalized * SCALE) / sellAmountNormalized;
        uint256 expectedRatio = (self.sellAsset.priceUSD(main) * SCALE) / self.buyAsset.priceUSD(main);

        return (ratio >= expectedRatio || expectedRatio - ratio <= main.config().auctionClearingTolerance);
    }
}
