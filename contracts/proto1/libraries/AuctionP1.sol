// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "contracts/proto1/interfaces/IAssetP1.sol";
import "contracts/proto1/interfaces/IAssetManagerP1.sol";
import "contracts/proto1/interfaces/IFurnaceP1.sol";
import "contracts/proto1/interfaces/IMainP1.sol";
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
    /// @dev Must be kept in sync with its duplicate in `IAssetManagerP1.sol`
    event AuctionStarted(
        address indexed sell,
        address indexed buy,
        uint256 sellAmount, // {qSellTok}
        uint256 minBuyAmount, // {qBuyTok}
        Fate fate
    );

    /// Emitted after an auction ends
    /// @param sellAmount {qSellTok} The quantity of the token sold
    /// @param buyAmount {qBuyTok} The quantity of the token bought
    event AuctionEnded(address indexed sell, address indexed buy, uint256 sellAmount, uint256 buyAmount, Fate fate);

    struct Info {
        IAssetP1 sell;
        IAssetP1 buy;
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
        emit AuctionStarted(address(self.sell), address(self.buy), self.sellAmount, self.minBuyAmount, self.fate);
    }

    /// Closes out the auction and sends bought token to its fate
    /// @return buyAmount {qBuyTok} The clearing buyAmount for the auction
    function close(Auction.Info storage self, IMainP1 main) internal returns (uint256 buyAmount) {
        require(self.isOpen, "already closed out");
        require(self.endTime <= block.timestamp, "auction not over");
        // TODO: buyAmount = batchAuction.claim();

        uint256 bal = self.buy.erc20().balanceOf(address(this)); // {qBuyTok}

        // solhint-disable no-empty-blocks
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
        // solhint-enable no-empty-blocks

        self.isOpen = false;
        emit AuctionEnded(address(self.sell), address(self.buy), self.sellAmount, buyAmount, self.fate);
        return buyAmount;
    }
}
