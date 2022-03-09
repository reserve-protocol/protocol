// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "contracts/interfaces/IAuction.sol";
import "contracts/libraries/Fixed.sol";

contract Auction is IAuction {
    using FixLib for Fix;
    using SafeERC20 for IERC20;

    AuctionState private state;

    address private owner;

    IMarket private market;

    // === Auction Info ===
    IERC20 public sell;
    IERC20 public buy;
    Fix public worstCasePrice; // {buyTok/sellTok}
    uint256 public endTime; // {sec}
    uint256 public externalId;

    /// Launch an auction on the provided market
    /// @dev Expects sell tokens to be transferred in prior to call
    function open(
        IMarket market_,
        ProposedAuction memory prop,
        uint256 endTime_
    ) external {
        require(state == AuctionState.NOT_STARTED, "auction already started");

        state = AuctionState.NOT_STARTED;
        owner = msg.sender;
        market = market_;

        sell = prop.sell.erc20();
        buy = prop.buy.erc20();
        worstCasePrice = toFix(prop.minBuyAmount).divu(prop.sellAmount);
        endTime = endTime_;

        sell.safeApprove(address(market), prop.sellAmount);
        buy.safeApprove(address(market), prop.buyAmount);
        externalId = market.initiateAuction(
            sell,
            buy,
            endTime,
            endTime,
            uint96(prop.sellAmount),
            uint96(prop.minBuyAmount),
            0,
            prop.minBuyAmount,
            false,
            address(0),
            new bytes(0)
        );
    }

    /// @return If the auction can be closed successfully
    function canClose() public view returns (bool) {
        return state == AuctionState.OPEN && block.timestamp >= endTime;
    }

    /// Close the auction and transfer tokens to the owner
    /// @dev Guarantees caller is transferred the amounts returned
    function close()
        external
        returns (
            bool success,
            uint256 soldAmt,
            uint256 boughtAmt
        )
    {
        require(canClose(), "auction not ready yet");
        require(state == AuctionState.OPEN, "auction not open");
        state = AuctionState.CLOSED;

        //
        // if (not settled in the Gnosis EasyAuction platform) {
        //   market.settleAuction(externalAuctionId);
        // }

        // Assert balances indicate an appropriate clearing price
        uint256 sellBal = sell.balanceOf(address(this));
        uint256 buyBal = buy.balanceOf(address(this));

        // soldAmt = ...
        // boughtAmt = ...

        Fix clearingPrice = toFix(boughtAmt).divu(soldAmt);
        if (clearingPrice.gte(worstCasePrice)) success = true;

        sell.safeTransfer(owner, sellBal);
        buy.safeTransfer(owner, buyBal);
    }
}
