// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IDutchTradeCallee, TradeStatus, DutchTrade } from "../trading/DutchTrade.sol";
import { IMain } from "../../interfaces/IMain.sol";

/** @title DutchTradeRouter
 * @notice Utility contract for placing bids on DutchTrade auctions
 */
contract DutchTradeRouter is IDutchTradeCallee {
    using SafeERC20 for IERC20;
    struct Bid {
        /// @notice The DutchTrade that was bid on
        DutchTrade trade;
        /// @notice The token sold to the protocol
        IERC20 sellToken;
        /// @notice The amount of tokenIn the protocol got {qSellAmt}
        uint256 sellAmt;
        /// @notice The token bought from the trade
        IERC20 buyToken;
        /// @notice The amount of tokenOut the we got {qBuyAmt}
        uint256 buyAmt;
    }

    /// @notice Emitted when a bid is placed
    /// @param main The main contract of the rToken
    /// @param trade The DutchTrade that was bid on
    /// @param bidder The address of the bidder
    /// @param sellToken The token being sold by the protocol
    /// @param soldAmt The amount of sellToken sold {qSellToken}
    /// @param buyToken The token being bought by the protocol
    /// @param boughtAmt The amount of buyToken bought {qBuyToken}
    event BidPlaced(
        IMain main,
        DutchTrade trade,
        address bidder,
        IERC20 sellToken,
        uint256 soldAmt,
        IERC20 buyToken,
        uint256 boughtAmt
    );
    DutchTrade private _currentTrade;

    /// Place a bid on an OPEN dutch auction
    /// @param trade The DutchTrade to bid on
    /// @param recipient The recipient of the tokens out
    /// @dev Requires msg.sender has sufficient approval on the tokenIn with router
    /// @dev Requires msg.sender has sufficient balance on the tokenIn
    function bid(DutchTrade trade, address recipient) external returns (Bid memory) {
        Bid memory out = _placeBid(trade, msg.sender);
        _sendBalanceTo(out.sellToken, recipient);
        _sendBalanceTo(out.buyToken, recipient);
        return out;
    }

    /// @notice Callback for DutchTrade
    /// @param buyToken The token DutchTrade is expecting to receive
    /// @param buyAmount The amt the DutchTrade is expecting to receive {qBuyToken}
    /// @notice Data is not used here
    function dutchTradeCallback(
        address buyToken,
        uint256 buyAmount,
        bytes calldata
    ) external {
        require(msg.sender == address(_currentTrade), "Incorrect callee");
        IERC20(buyToken).safeTransfer(msg.sender, buyAmount); //  {qBuyToken}
    }

    function _sendBalanceTo(IERC20 token, address to) internal {
        uint256 bal = token.balanceOf(address(this));
        token.safeTransfer(to, bal);
    }

    /// Helper for placing bid on DutchTrade
    /// @notice pulls funds from 'bidder'
    /// @notice Does not send proceeds anywhere, funds have to be transfered out after this call
    /// @notice non-reentrant, uses _currentTrade to prevent reentrancy
    function _placeBid(DutchTrade trade, address bidder) internal returns (Bid memory out) {
        // Prevent reentrancy
        require(_currentTrade == DutchTrade(address(0)), "already bidding");
        require(trade.status() == TradeStatus.OPEN, "trade not open");
        _currentTrade = trade;
        out.trade = trade;
        out.buyToken = IERC20(trade.buy());
        out.sellToken = IERC20(trade.sell());
        out.buyAmt = trade.bidAmount(uint48(block.timestamp)); // {qBuyToken}
        out.buyToken.safeTransferFrom(bidder, address(this), out.buyAmt);

        uint256 sellAmt = out.sellToken.balanceOf(address(this)); // {qSellToken}

        uint256 expectedSellAmt = trade.lot(); // {qSellToken}
        trade.bidWithCallback(new bytes(0));

        sellAmt = out.sellToken.balanceOf(address(this)) - sellAmt; // {qSellToken}
        require(sellAmt >= expectedSellAmt, "insufficient amount out");
        out.sellAmt = sellAmt; // {qSellToken}

        _currentTrade = DutchTrade(address(0));
        emit BidPlaced(
            IMain(address(out.trade.broker().main())),
            out.trade,
            bidder,
            out.sellToken,
            out.sellAmt,
            out.buyToken,
            out.buyAmt
        );
    }
}
