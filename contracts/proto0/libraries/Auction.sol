// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../interfaces/ICollateral.sol";
import "../interfaces/IFurnace.sol";
import "../interfaces/IOracle.sol";

library Auction {
    using SafeERC20 for IERC20;

    struct Info {
        ICollateral sellCollateral; // empty if selling RSR or COMP/AAVE
        ICollateral buyCollateral; // empty if buying RToken
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
        ICollateral sellCollateral,
        ICollateral buyCollateral,
        address sellToken,
        address buyToken,
        uint256 sellAmount,
        uint256 minBuyAmount,
        uint256 endTime,
        address destination
    ) internal {
        self.sellCollateral = sellCollateral;
        self.buyCollateral = buyCollateral;
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
        IOracle oracle,
        uint256 SCALE,
        uint256 buyAmount,
        uint256 tolerance
    ) internal returns (bool) {
        assert(address(self.sellCollateral) == address(0) && address(self.buyCollateral) == address(0));

        uint256 sellAmountNormalized = self.sellAmount * 10**(SCALE - self.sellCollateral.decimals());
        uint256 buyAmountNormalized = buyAmount * 10**(SCALE - self.buyCollateral.decimals());
        uint256 ratio = (buyAmountNormalized * SCALE) / sellAmountNormalized;

        uint256 expectedSellPrice = oracle.fiatcoinPrice(self.sellCollateral) * self.sellCollateral.redemptionRate();
        uint256 expectedBuyPrice = oracle.fiatcoinPrice(self.buyCollateral) * self.buyCollateral.redemptionRate();
        uint256 expectedRatio = (expectedSellPrice * SCALE) / expectedBuyPrice;

        return (ratio >= expectedRatio || expectedRatio - ratio <= tolerance);
    }
}
