// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "../interfaces/ICollateral.sol";
import "../interfaces/IOracle.sol";

library Auction {
    struct Info {
        ICollateral sellCollateral; // empty if RSR
        ICollateral buyCollateral; // empty if RToken
        address sellToken;
        address buyToken;
        uint256 sellAmount;
        uint256 minBuyAmount;
        uint256 startTime;
        uint256 endTime;
        bool open;
    }

    function start(
        Auction.Info storage self,
        ICollateral sellCollateral,
        ICollateral buyCollateral,
        address sellToken,
        address buyToken,
        uint256 sellAmount,
        uint256 minBuyAmount,
        uint256 endTime
    ) internal {
        self.sellCollateral = sellCollateral;
        self.buyCollateral = buyCollateral;
        self.sellToken = sellToken;
        self.buyToken = buyToken;
        self.sellAmount = sellAmount;
        self.minBuyAmount = minBuyAmount;
        self.startTime = block.timestamp;
        self.endTime = endTime;
        self.open = true;

        // TODO: batchAuction.initiateAuction()
    }

    // Returns the buyAmount for the auction after clearing. 
    function closeOut(Auction.Info storage self) internal returns (uint256 buyAmount) {
        require(self.open, "already closed out");
        // TODO: buyAmount = batchAuction.claim();
        self.open = false;
    }

    function clearedCloseToOraclePrice(Auction.Info storage self, IOracle oracle, uint256 SCALE, uint256 buyAmount, uint256 tolerance) internal view returns (bool) {
        assert(address(self.sellCollateral) == address(0) && address(self.buyCollateral) == address(0));

        uint256 sellAmountNormalized = self.sellAmount * 10**(SCALE - self.sellCollateral.decimals());
        uint256 buyAmountNormalized = buyAmount * 10**(SCALE - self.buyCollateral.decimals());
        uint256 ratio = buyAmountNormalized * SCALE / sellAmountNormalized;

        uint256 expectedSellPrice = oracle.fiatcoinPrice(self.sellCollateral) * self.sellCollateral.redemptionRate();
        uint256 expectedBuyPrice = oracle.fiatcoinPrice(self.buyCollateral) * self.buyCollateral.redemptionRate();
        uint256 expectedRatio = expectedSellPrice * SCALE / expectedBuyPrice;

        return (ratio >= expectedRatio || expectedRatio - ratio <= tolerance);
    }
}
