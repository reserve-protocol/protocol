// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../interfaces/IAsset.sol";
import "../interfaces/IFurnace.sol";

library Auction {
    using SafeERC20 for IERC20;

    struct Info {
        IAsset sellAsset; // empty if selling RSR or COMP/AAVE
        IAsset buyAsset; // empty if buying RToken
        address sellToken;
        address buyToken;
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
        address sellToken,
        address buyToken,
        uint256 sellAmount,
        uint256 minBuyAmount,
        uint256 endTime,
        address destination
    ) internal {
        self.sellAsset = sellAsset;
        self.buyAsset = buyAsset;
        self.sellToken = sellToken;
        self.buyToken = buyToken;
        self.sellAmount = sellAmount;
        self.minBuyAmount = minBuyAmount;
        self.startTime = block.timestamp;
        self.endTime = endTime;
        self.destination = destination;
        self.open = true;

        // TODO: batchAuction.initiateAuction()
    }

    // Returns the buyAmount for the auction after clearing.
    function closeOut(Auction.Info storage self, uint256 rewardPeriod) internal returns (uint256 buyAmount) {
        require(self.open, "already closed out");
        require(self.endTime <= block.timestamp, "auction not over");
        // TODO: buyAmount = batchAuction.claim();
        uint256 bal = IERC20(self.buyToken).balanceOf(address(this));
        if (self.destination == address(0)) {
            // Burn
            IERC20(self.buyToken).safeTransfer(address(0), bal);
        } else if (self.destination != address(this)) {
            // Send to the Furnace for slow burning
            IERC20(self.buyToken).safeApprove(self.destination, bal);
            IFurnace(self.destination).burnOverPeriod(bal, rewardPeriod);
        }
        self.open = false;
        return buyAmount;
    }

    // Returns false if the auction buyAmount is > *threshold* of the expected buyAmount.
    function clearedCloseToOraclePrice(
        Auction.Info storage self,
        uint256 SCALE,
        uint256 buyAmount,
        uint256 tolerance
    ) internal view returns (bool) {
        assert(address(self.sellAsset) == address(0) && address(self.buyAsset) == address(0));

        uint256 sellAmountNormalized = self.sellAmount * 10**(SCALE - self.sellAsset.decimals());
        uint256 buyAmountNormalized = buyAmount * 10**(SCALE - self.buyAsset.decimals());
        uint256 ratio = (buyAmountNormalized * SCALE) / sellAmountNormalized;
        uint256 expectedRatio = (self.sellAsset.priceUSD() * SCALE) / self.buyAsset.priceUSD();

        return (ratio >= expectedRatio || expectedRatio - ratio <= tolerance);
    }
}
