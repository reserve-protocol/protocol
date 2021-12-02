// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "contracts/p0/interfaces/IAsset.sol";
import "contracts/p0/interfaces/IMarket.sol";
import "contracts/p0/interfaces/IFurnace.sol";
import "contracts/p0/interfaces/IStRSR.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/libraries/Fixed.sol";

/// @dev This can probably be removed at some point, it's relationship with AssetManager is too close
library Auction {
    using SafeERC20 for IERC20;
    using FixLib for Fix;

    enum State {
        NOT_STARTED,
        IN_PROGRESS,
        DONE
    }

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
        State state;
    }

    /// Creates an auction in an external batch auction protocol
    /// @dev The struct must already be populated
    function open(
        Auction.Info storage self,
        uint256 auctionPeriod,
        IMarket market
    ) internal {
        self.sell.erc20().safeApprove(address(market), self.sellAmount);
        self.externalAuctionId = market.initiateAuction(
            self.sell.erc20(),
            self.buy.erc20(),
            block.timestamp + auctionPeriod,
            block.timestamp + auctionPeriod,
            uint96(self.sellAmount),
            uint96(self.minBuyAmount),
            0,
            0,
            false,
            address(0),
            new bytes(0)
        );
        self.state = State.IN_PROGRESS;
    }

    /// Closes out the auction and sends bought token to its fate
    function close(
        Auction.Info storage self,
        IFurnace furnace,
        IStRSR stRSR,
        uint256 rewardPeriod,
        IMarket market
    ) internal {
        require(self.state == Auction.State.IN_PROGRESS, "can only close in-progress auctions");
        require(self.endTime <= block.timestamp, "auction not over");
        bytes32 encodedOrder = market.settleAuction(self.externalAuctionId);
        (self.clearingSellAmount, self.clearingBuyAmount) = _decodeOrder(encodedOrder);

        uint256 bal = self.buy.erc20().balanceOf(address(this)); // {qBuyTok}

        // solhint-disable no-empty-blocks
        if (bal > 0) {
            if (self.fate == Fate.Burn) {
                self.buy.erc20().safeTransfer(address(0), bal);
            } else if (self.fate == Fate.Melt) {
                self.buy.erc20().safeApprove(address(furnace), bal);
                furnace.receiveERC20(self.buy.erc20(), bal);
            } else if (self.fate == Fate.Stake) {
                stRSR.receiveERC20(self.buy.erc20(), bal);
                // Restore allowance
                self.buy.erc20().safeIncreaseAllowance(address(stRSR), bal);
            } else if (self.fate == Fate.Stay) {
                // Do nothing; token is already in the right place
            } else {
                assert(false);
            }
        }
        // solhint-enable no-empty-blocks

        self.state = State.DONE;
    }

    /// Decodes the output of the EasyAuction
    function _decodeOrder(bytes32 encodedOrder)
        private
        pure
        returns (uint256 clearingSellAmount, uint256 clearingBuyAmount)
    {
        // Note: converting to uint discards the binary digits that do not fit
        // the type.
        // userId = uint64(uint256(encodedOrder) >> 192);

        clearingSellAmount = uint256(encodedOrder);
        clearingBuyAmount = uint256(uint96(uint256(encodedOrder) >> 96));
    }
}
