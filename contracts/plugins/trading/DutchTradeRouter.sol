// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IDutchTradeCallee, TradeStatus, DutchTrade } from "../trading/DutchTrade.sol";
import { IMain } from "../../interfaces/IMain.sol";

contract DutchTradeRouter is IDutchTradeCallee {
    using SafeERC20 for IERC20;
    struct Bid {
        /// @notice The DutchTrade that was bid on
        DutchTrade trade;
        /// @notice The token sold to the protocol
        IERC20 sellToken;
        /// @notice The amount of tokenIn the protocol got
        uint256 sellAmt;
        /// @notice The token bought from the trade
        IERC20 buyToken;
        /// @notice The amount of tokenOut the we got
        uint256 buyAmt;
    }

    /// @notice Emitted when a bid is placed
    /// @param main The main contract of the rToken
    /// @param trade The DutchTrade that was bid on
    /// @param bidder The address of the bidder
    /// @param sellToken The token being sold by the protocol
    /// @param soldAmt The amount of sellToken sold
    /// @param buyToken The token being bought by the protocol
    /// @param boughtAmt The amount of buyToken bought
    event BidPlaced(
        IMain main,
        DutchTrade trade,
        address bidder,
        IERC20 sellToken,
        uint256 soldAmt,
        IERC20 buyToken,
        uint256 boughtAmt
    );
    DutchTrade private _currentTrade = DutchTrade(address(0));

    /// Place a bid on an OPEN dutch auction
    /// @param trade The DutchTrade to bid on
    /// @param recipient The recipient of the tokens out
    /// @dev Requires msg.sender has sufficient approval on the tokenIn with router
    /// @dev Requires msg.sender has sufficient balance on the tokenIn
    function bid(DutchTrade trade, address recipient) external returns (Bid memory) {
        Bid memory out = Bid({
            trade: DutchTrade(address(0)),
            sellToken: IERC20(address(0)),
            sellAmt: 0,
            buyToken: IERC20(address(0)),
            buyAmt: 0
        });
        _placeBid(trade, out, msg.sender);
        _sendBalanceTo(out.sellToken, recipient);
        _sendBalanceTo(out.buyToken, recipient);
        return out;
    }

    /// @notice Callback for DutchTrade
    /// @param caller The caller of the callback, should be the router
    /// @param buyToken The token DutchTrade is expecting to receive
    /// @param buyAmount The amt the DutchTrade is expecting to receive
    /// @notice Data is not used here
    function dutchTradeCallback(
        address caller,
        address buyToken,
        uint256 buyAmount,
        bytes calldata
    ) external {
        require(caller == address(this), "Invalid caller");
        require(msg.sender == address(_currentTrade), "Incorrect callee");
        IERC20(buyToken).safeTransfer(msg.sender, buyAmount);
    }

    function _sendBalanceTo(IERC20 token, address to) internal {
        uint256 bal = token.balanceOf(address(this));
        if (bal == 0) {
            return;
        }
        token.safeTransfer(to, bal);
    }

    // Places a bid on a Dutch auction
    // Method will dynamically pull funds from msg.sender if needed
    // This will technically allow us to bid on multiple auctions at once
    function _placeBid(
        DutchTrade trade,
        Bid memory out,
        address bidder
    ) internal {
        // Prevent reentrancy
        require(_currentTrade == DutchTrade(address(0)), "already bidding");
        require(trade.status() == TradeStatus.OPEN, "trade not open");
        out.trade = trade;
        out.buyToken = IERC20(trade.buy());
        out.sellToken = IERC20(trade.sell());
        out.buyAmt = trade.bidAmount(block.number);

        uint256 currentBalance = out.buyToken.balanceOf(address(this));
        if (currentBalance < out.buyAmt) {
            out.buyToken.safeTransferFrom(bidder, address(this), out.buyAmt - currentBalance);
        }
        uint256 sellAmt = out.sellToken.balanceOf(address(this));
        _currentTrade = trade;
        uint256 expectedSellAmt = trade.lot();
        trade.bid(new bytes(0));
        sellAmt = out.sellToken.balanceOf(address(this)) - sellAmt;
        require(sellAmt >= expectedSellAmt, "insufficient amount out");
        out.sellAmt = sellAmt;

        emit BidPlaced(
            IMain(address(out.trade.broker().main())),
            out.trade,
            bidder,
            out.sellToken,
            out.sellAmt,
            out.buyToken,
            out.buyAmt
        );
        _currentTrade = DutchTrade(address(0));
    }
}
