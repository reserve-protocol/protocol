// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "contracts/interfaces/IMain.sol";
import "contracts/interfaces/IMarket.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/p0/Component.sol";
import "contracts/p0/Rewardable.sol";

abstract contract TraderP0 is RewardableP0, ITrader {
    using FixLib for Fix;
    using SafeERC20 for IERC20;

    // All ongoing auctions
    OngoingAuction[] public auctions;

    // First auction that is not yet closed (or auctions.length if all auctions have been closed)
    uint256 internal auctionsStart;

    // The latest end time for any auction in `auctions`.
    uint256 private latestAuctionEnd;

    // === Gov Params ===
    uint256 public auctionLength; // {s} the length of an auction
    Fix public maxTradeSlippage; // {%} max slippage acceptable in a trade
    Fix public dustAmount; // {UoA} value below which we don't bother handling some tokens

    function init(ConstructorArgs calldata args) internal virtual override {
        auctionLength = args.params.auctionLength;
        maxTradeSlippage = args.params.maxTradeSlippage;
        dustAmount = args.params.dustAmount;
    }

    /// @return true iff this trader now has open auctions.
    function hasOpenAuctions() public view returns (bool) {
        return auctions.length > auctionsStart;
    }

    /// Settle any auctions that are due (past their end time)
    function closeDueAuctions() public {
        // Close open auctions
        uint256 i = auctionsStart;
        for (; i < auctions.length && block.timestamp >= auctions[i].endTime; i++) {
            OngoingAuction storage auc = auctions[i];
            (uint256 clearingSellAmt, uint256 clearingBuyAmt) = decodeOrder(
                main.market().settleAuction(auc.externalId)
            );
            emit AuctionEnded(i, auc.sell, auc.buy, clearingSellAmt, clearingBuyAmt);
        }
        auctionsStart = i;
    }

    /// Prepare an auction to sell `sellAmount` that guarantees a reasonable closing price,
    /// without explicitly aiming at a particular quantity to purchase.
    /// @param sellAmount {sellTok}
    /// @return notDust Whether the prepared auction is large enough to be worth trading
    /// @return auction The prepared auction
    function prepareAuctionSell(
        IAsset sell,
        IAsset buy,
        Fix sellAmount
    ) internal view returns (bool notDust, ProposedAuction memory auction) {
        assert(sell.price().neq(FIX_ZERO) && buy.price().neq(FIX_ZERO));

        // Don't buy dust.
        if (sellAmount.lt(dustThreshold(sell))) return (false, auction);

        // {sellTok}
        sellAmount = fixMin(sellAmount, sell.maxAuctionSize().div(sell.price()));

        // {buyTok} = {sellTok} * {UoA/sellTok} / {UoA/buyTok}
        Fix exactBuyAmount = sellAmount.mul(sell.price()).div(buy.price());
        Fix minBuyAmount = exactBuyAmount.mul(FIX_ONE.minus(maxTradeSlippage));

        // TODO Check floor() and ceil() rounding below
        return (
            true,
            ProposedAuction({
                sell: sell.erc20(),
                buy: buy.erc20(),
                sellAmount: sell.toQ(sellAmount).floor(),
                minBuyAmount: buy.toQ(minBuyAmount).ceil()
            })
        );
    }

    /// Assuming we have `maxSellAmount` sell tokens avaialable, prepare an auction to
    /// cover as much of our deficit as possible, given expected trade slippage.
    /// @param maxSellAmount {sellTok}
    /// @param deficitAmount {buyTok}
    /// @return notDust Whether the prepared auction is large enough to be worth trading
    /// @return auction The prepared auction
    function prepareAuctionToCoverDeficit(
        IAsset sell,
        IAsset buy,
        Fix maxSellAmount,
        Fix deficitAmount
    ) internal view returns (bool notDust, ProposedAuction memory auction) {
        // Don't sell dust.
        if (maxSellAmount.lt(dustThreshold(sell))) return (false, auction);

        // Don't buy dust.
        deficitAmount = fixMax(deficitAmount, dustThreshold(buy));

        // {sellTok} = {buyTok} * {UoA/buyTok} / {UoA/sellTok}
        Fix exactSellAmount = deficitAmount.mul(buy.price()).div(sell.price());
        // exactSellAmount: Amount to sell to buy `deficitAmount` if there's no slippage

        // idealSellAmount: Amount needed to sell to buy `deficitAmount`, counting slippage
        Fix idealSellAmount = exactSellAmount.div(FIX_ONE.minus(maxTradeSlippage));

        Fix sellAmount = fixMin(idealSellAmount, maxSellAmount);
        return prepareAuctionSell(sell, buy, sellAmount);
    }

    /// @return {tok} The least amount of whole tokens ever worth trying to sell
    function dustThreshold(IAsset asset) internal view returns (Fix) {
        // {tok} = {UoA} / {UoA/tok}
        return dustAmount.div(asset.price());
    }

    /// Launch an auction:
    /// - Add the auction to the local auction list
    /// - Create the auction in the external auction protocol
    /// - Emit AuctionStarted event
    function launchAuction(ProposedAuction memory prop) internal {
        OngoingAuction storage ongoing = auctions.push();

        uint256 endTime = Math.min(block.timestamp + auctionLength, latestAuctionEnd);
        prop.sell.safeApprove(address(main.market()), prop.sellAmount);

        ongoing.sell = prop.sell;
        ongoing.buy = prop.buy;
        ongoing.endTime = endTime;
        ongoing.externalId = main.market().initiateAuction(
            prop.sell,
            prop.buy,
            endTime,
            endTime,
            uint96(prop.sellAmount),
            uint96(prop.minBuyAmount),
            0,
            0,
            false,
            address(0),
            new bytes(0)
        );

        latestAuctionEnd = endTime;

        uint256 index = auctions.length - 1;
        emit AuctionStarted(index, prop.sell, prop.buy, prop.sellAmount, prop.minBuyAmount);
    }

    /// Close auctions[i]:
    /// - Set the auction status to DONE
    /// - Settle the auction in the external auction protocl
    /// - Emit AuctionEnded event

    /// Decode EasyAuction output into its components.
    function decodeOrder(bytes32 encodedOrder)
        private
        pure
        returns (uint256 amountSold, uint256 amountBought)
    {
        // Note: explicitly converting to a uintN truncates those bits that don't fit
        uint256 value = uint256(encodedOrder);
        amountSold = uint96(value);
        amountBought = uint96(value >> 96);
    }
}
