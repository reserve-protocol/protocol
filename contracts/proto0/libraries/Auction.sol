// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "contracts/proto0/interfaces/IAsset.sol";
import "contracts/proto0/interfaces/IAssetManager.sol";
import "contracts/proto0/interfaces/IFurnace.sol";
import "contracts/proto0/interfaces/IMain.sol";
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

    /// Emitted when an auction is started
    /// @param sell The token to sell
    /// @param buy The token to buy
    /// @param sellAmount {qSellTok} The quantity of the selling token
    /// @param minBuyAmount {qBuyTok} The minimum quantity of the buying token to accept
    /// @param fate The fate of the soon-to-be-purchased tokens
    /// @dev Must be kept in sync with its duplicate in `IAssetManager.sol`
    event AuctionStarted(
        address indexed sell,
        address indexed buy,
        uint256 sellAmount, // {qSellTok}
        uint256 minBuyAmount, // {qBuyTok}
        Fate fate
    );

    struct Info {
        IAsset sell;
        IAsset buy;
        uint256 sellAmount; // {qSellTok}
        uint256 minBuyAmount; // {qBuyTok}
        uint256 startTime; // {sec}
        uint256 endTime; // {sec}
        Fate fate;
        bool isOpen;
    }


    function open(Auction.Info storage self) internal {
        // TODO: batchAuction.initiateAuction()
        self.isOpen = true;
        emit AuctionStarted(
            address(self.sell),
            address(self.buy),
            self.sellAmount,
            self.minBuyAmount,
            self.fate
        );
    }

    /// Closes out the auction and sends bought token to its fate
    /// @return buyAmount {qBuyTok} The clearing buyAmount for the auction
    function close(Auction.Info storage self, IMain main) internal returns (uint256 buyAmount) {
        require(self.isOpen, "already closed out");
        require(self.endTime <= block.timestamp, "auction not over");
        // TODO: buyAmount = batchAuction.claim();

        uint256 bal = self.buy.erc20().balanceOf(address(this)); // {qBuyTok}

        if (self.fate == Fate.Burn) {
            self.buy.erc20().safeTransfer(address(0), bal);
        } else if (self.fate == Fate.Melt) {
            self.buy.erc20().safeApprove(address(main.furnace()), bal);
            main.furnace().burnOverPeriod(bal, main.config().rewardPeriod);
        } else if (self.fate == Fate.Stake) {
            self.buy.erc20().safeApprove(address(main.stRSR()), bal);
            main.stRSR().addRSR(bal);
        } else if (self.fate == Fate.Stay) {
            // Do nothing; token is already in the right place
        } else {
            assert(false);
        }
        self.isOpen = false;
        return buyAmount;
    }

    /// Checks that final clearing price is reasonable
    /// @param buyAmount {qBuyTok}
    /// @return false if `buyAmount` is > config.auctionClearingTolerance of the expected buy amount
    function clearedCloseToOraclePrice(
        Auction.Info storage self,
        IMain main,
        uint256 buyAmount
    ) internal returns (bool) {
        // {qBuyTok/qSellTok} = {qBuyTok} / {qSellTok}
        Fix clearedRate = toFix(buyAmount).divu(self.sellAmount);

        // {USD/qSellTok} = {USD/wholeSellTok} * {wholeSellTok/qSellTok}
        Fix qSellUSD = self.sell.priceUSD(main).mulu(10**self.sell.decimals());

        // {USD/qBuyTok} = {USD/wholeBuyTok} * {wholeBuyTok/qBuyTok}
        Fix qBuyUSD = self.buy.priceUSD(main).mulu(10**self.buy.decimals());

        // {qBuyTok/qSellTok} = {USD/qSellTok} / {USD/qBuyTok}
        Fix expectedRate = qSellUSD.div(qBuyUSD);

        // 1 - clearedRate/expectedRate <= auctionClearingTolerance
        return FIX_ONE.minus((clearedRate).div(expectedRate)).lte(main.config().auctionClearingTolerance);
    }
}
