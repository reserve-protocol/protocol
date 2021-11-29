// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "contracts/p0/interfaces/IAsset.sol";
import "contracts/p0/interfaces/IMarket.sol";
import "contracts/p0/interfaces/IFurnace.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/libraries/Fixed.sol";

/// @dev This can probably be removed at some point, it's relationship with AssetManager is too close
library Auction {
    using SafeERC20 for IERC20;
    using FixLib for Fix;

    struct Info {
        IAsset sell;
        IAsset buy;
        uint256 sellAmount; // {qSellTok}
        uint256 minBuyAmount; // {qBuyTok}
        uint256 startTime; // {sec}
        uint256 endTime; // {sec}
        uint256 clearingSellAmount;
        uint256 clearingBuyAmount;
        uint256 externalAuctionId;
        Fate fate;
        bool isOpen;
    }

    /// Creates an auction in an external batch auction protocol
    /// @dev The struct must already be populated
    function open(
        Auction.Info storage self,
        address main,
        IMarket market
    ) internal {
        self.sell.erc20().safeApprove(address(market), self.sellAmount);
        self.externalAuctionId = market.initiateAuction(
            self.sell.erc20(),
            self.buy.erc20(),
            self.sellAmount,
            self.minBuyAmount,
            IMain(main).config().auctionPeriod
        );
        self.isOpen = true;
    }

    /// Closes out the auction and sends bought token to its fate
    function close(
        Auction.Info storage self,
        address main,
        IMarket market
    ) internal {
        require(self.isOpen, "already closed out");
        require(self.endTime <= block.timestamp, "auction not over");
        (self.clearingSellAmount, self.clearingBuyAmount) = market.clear(self.externalAuctionId);

        uint256 bal = self.buy.erc20().balanceOf(address(this)); // {qBuyTok}

        // solhint-disable no-empty-blocks
        if (bal > 0) {
            if (self.fate == Fate.Burn) {
                self.buy.erc20().safeTransfer(address(0), bal);
            } else if (self.fate == Fate.Melt) {
                self.buy.erc20().safeApprove(address(IMain(main).furnace()), bal);
                IMain(main).furnace().burnOverPeriod(bal, IMain(main).config().rewardPeriod);
            } else if (self.fate == Fate.Stake) {
                IMain(main).stRSR().addRSR(bal);

                // Restore allowance
                self.buy.erc20().safeIncreaseAllowance(address(IMain(main).stRSR()), bal);
            } else if (self.fate == Fate.Stay) {
                // Do nothing; token is already in the right place
            } else {
                assert(false);
            }
        }
        // solhint-enable no-empty-blocks

        self.isOpen = false;
    }
}
