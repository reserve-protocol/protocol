// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "contracts/p0/interfaces/IAsset.sol";
import "contracts/p0/interfaces/IAssetManager.sol";
import "contracts/p0/interfaces/IMarket.sol";
import "contracts/p0/interfaces/IFurnace.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/RTokenP0.sol";
import "contracts/libraries/Fixed.sol";

enum Fate {
    Melt, // RToken melting in the furnace
    Stake, // RSR dividend to stRSR
    Burn, // RToken burning
    Stay // No action needs to be taken; tokens can be left at the callers address
}

/// @dev This can probably be removed at some point, it's relationship with AssetManager is too close
library Auction {
    using SafeERC20 for IERC20;
    using FixLib for Fix;

    /// Emitted when an auction is started
    /// @param auctionId The index of the AssetManager.auctions array
    /// @param sell The token to sell
    /// @param buy The token to buy
    /// @param sellAmount {qSellTok} The quantity of the selling token
    /// @param minBuyAmount {qBuyTok} The minimum quantity of the buying token to accept
    /// @param fate The fate of the soon-to-be-purchased tokens
    /// @dev Must be kept in sync with its duplicate in `IAssetManager.sol`
    event AuctionStarted(
        uint256 indexed auctionId,
        address indexed sell,
        address indexed buy,
        uint256 sellAmount, // {qSellTok}
        uint256 minBuyAmount, // {qBuyTok}
        Fate fate
    );

    /// Emitted after an auction ends
    /// @param auctionId The index of the AssetManager.auctions array
    /// @param sellAmount {qSellTok} The quantity of the token sold
    /// @param buyAmount {qBuyTok} The quantity of the token bought
    event AuctionEnded(
        uint256 indexed auctionId,
        address indexed sell,
        address indexed buy,
        uint256 sellAmount,
        uint256 buyAmount,
        Fate fate
    );

    struct Info {
        IAsset sell;
        IAsset buy;
        uint256 sellAmount; // {qSellTok}
        uint256 minBuyAmount; // {qBuyTok}
        uint256 startTime; // {sec}
        uint256 endTime; // {sec}
        uint256 clearingSellAmount;
        uint256 clearingBuyAmount;
        Fate fate;
        bool isOpen;
    }

    /// Creates an auction in an external batch auction protocol
    /// @dev The struct must already be populated
    function open(
        Auction.Info storage self,
        IMain main,
        IMarket market,
        uint256 internalAuctionId
    ) internal {
        self.sell.erc20().safeApprove(address(market), self.sellAmount);
        market.initiateAuction(
            self.sell.erc20(),
            self.buy.erc20(),
            self.sellAmount,
            self.minBuyAmount,
            main.config().auctionPeriod
        );
        self.isOpen = true;
        emit AuctionStarted(
            internalAuctionId,
            address(self.sell),
            address(self.buy),
            self.sellAmount,
            self.minBuyAmount,
            self.fate
        );
    }

    /// Closes out the auction and sends bought token to its fate
    function close(
        Auction.Info storage self,
        IMain main,
        IMarket market,
        uint256 internalAuctionId
    ) internal {
        require(self.isOpen, "already closed out");
        require(self.endTime <= block.timestamp, "auction not over");
        (self.clearingSellAmount, self.clearingBuyAmount) = market.clear(internalAuctionId);

        uint256 bal = self.buy.erc20().balanceOf(address(this)); // {qBuyTok}

        // solhint-disable no-empty-blocks
        if (bal > 0) {
            if (self.fate == Fate.Burn) {
                // If the Fate is Burn, then the only valid buy token is RToken
                RTokenP0(address(self.buy.erc20())).burn(address(this), bal);
            } else if (self.fate == Fate.Melt) {
                self.buy.erc20().safeApprove(address(main.furnace()), bal);
                main.furnace().burnOverPeriod(bal, main.config().rewardPeriod);
            } else if (self.fate == Fate.Stake) {
                main.stRSR().addRSR(bal);

                // Restore allowance
                self.buy.erc20().safeIncreaseAllowance(address(main.stRSR()), bal);
            } else if (self.fate == Fate.Stay) {
                // Do nothing; token is already in the right place
            } else {
                assert(false);
            }
        }
        // solhint-enable no-empty-blocks

        self.isOpen = false;
        emit AuctionEnded(
            internalAuctionId,
            address(self.sell),
            address(self.buy),
            self.clearingSellAmount,
            self.clearingBuyAmount,
            self.fate
        );
    }
}
