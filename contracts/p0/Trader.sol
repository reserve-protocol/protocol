// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "contracts/p0/libraries/Auction.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/interfaces/IMarket.sol";

contract Trader is Ownable {
    Auction.Info[] public auctions;

    IVaultHandler public main;

    constructor(IVaultHandler main_) {
        main = main_;
    }

    /// @return Whether the trader has open auctions
    function poke() public virtual returns (bool) {
        // Closeout open auctions or sleep if they are still ongoing.
        for (uint256 i = 0; i < auctions.length; i++) {
            Auction.Info storage auction = auctions[i];
            if (auction.state == Auction.State.IN_PROGRESS) {
                if (block.timestamp <= auction.endTime) {
                    return true;
                }
                auction.close(main.furnace(), main.stRSR(), main.rewardPeriod(), main.market());
                emit IAuctioneer.AuctionEnded(
                    i,
                    address(auction.sell),
                    address(auction.buy),
                    auction.clearingSellAmount,
                    auction.clearingBuyAmount,
                    auction.fate
                );
            }
        }
        return false;
    }

    function setMain(IVaultHandler main_) external onlyOwner {
        main = main_;
    }

    /// Prepare an auction to sell `sellAmount` that guarantees a reasonable closing price
    /// @param minAuctionSize {none}
    /// @param sellAmount {qSellTok}
    /// @return (notDust, auction) An auction and whether it is large enough to be worth trading
    function _prepareAuctionSell(
        Fix minAuctionSize, // TODO: currently unused
        IAsset sell,
        IAsset buy,
        uint256 sellAmount,
        Fate fate
    ) internal returns (bool notDust, Auction.Info memory auction) {
        Oracle.Info memory oracle = main.oracle();
        // {attoUSD} = {attoUSD/qSellTok} * {qSellTok}
        Fix rTokenMarketCapUSD = main.rTokenAsset().priceUSD(oracle).mulu(
            main.rToken().totalSupply()
        );
        Fix maxSellUSD = rTokenMarketCapUSD.mul(main.maxAuctionSize()); // {attoUSD}

        if (sellAmount < _dustThreshold(sell)) {
            return (false, auction);
        }

        sellAmount = Math.min(sellAmount, maxSellUSD.div(sell.priceUSD(oracle)).toUint()); // {qSellTok}
        Fix exactBuyAmount = toFix(sellAmount).mul(sell.priceUSD(oracle)).div(buy.priceUSD(oracle)); // {qBuyTok}
        Fix minBuyAmount = exactBuyAmount.minus(exactBuyAmount.mul(main.maxTradeSlippage())); // {qBuyTok}

        return (
            true,
            Auction.Info({
                sell: sell,
                buy: buy,
                sellAmount: sellAmount,
                minBuyAmount: minBuyAmount.toUint(),
                clearingSellAmount: 0,
                clearingBuyAmount: 0,
                externalAuctionId: 0,
                startTime: block.timestamp,
                endTime: block.timestamp + main.auctionPeriod(),
                fate: fate,
                isOpen: false
            })
        );
    }

    /// Assuming we have `maxSellAmount` sell tokens avaialable, prepare an auction to
    /// cover as much of our deficit as possible, given expected trade slippage.
    /// @param maxSellAmount {qSellTok}
    /// @param deficitAmount {qBuyTok}
    /// @return (notDust, auction) An auction and whether it is large enough to be worth trading
    function _prepareAuctionToCoverDeficit(
        Fix minAuctionSize,
        IAsset sell,
        IAsset buy,
        uint256 maxSellAmount,
        uint256 deficitAmount,
        Fate fate
    ) internal returns (bool notDust, Auction.Info memory auction) {
        Oracle.Info memory oracle = main.oracle();
        uint256 sellThreshold = _dustThreshold(sell);
        if (maxSellAmount < sellThreshold) {
            return (false, auction);
        }

        uint256 buyThreshold = _dustThreshold(buy);
        if (deficitAmount < buyThreshold) {
            deficitAmount = buyThreshold;
        }

        // {qSellTok} = {qBuyTok} * {attoUSD/qBuyTok} / {attoUSD/qSellTok}
        Fix exactSellAmount = toFix(deficitAmount).mul(buy.priceUSD(oracle)).div(
            sell.priceUSD(oracle)
        );

        // idealSellAmount = Amount needed to sell to buy `deficitAmount`
        uint256 idealSellAmount = exactSellAmount
        .div(FIX_ONE.minus(main.maxTradeSlippage()))
        .toUint();

        uint256 sellAmount = Math.min(idealSellAmount, maxSellAmount);
        return _prepareAuctionSell(minAuctionSize, sell, buy, sellAmount, fate);
    }

    /// @return {qSellTok} The least amount of tokens worth trying to sell
    function _dustThreshold(IAsset asset) private view returns (uint256) {
        // {attoUSD} = {attoUSD/qSellTok} * {qSellTok}
        Fix rTokenMarketCapUSD = main.rTokenAsset().priceUSD(main.oracle()).mulu(
            main.rToken().totalSupply()
        );
        Fix minSellUSD = rTokenMarketCapUSD.mul(main.minAuctionSize()); // {attoUSD}

        // {attoUSD} / {attoUSD/qSellTok}
        return minSellUSD.div(asset.priceUSD(main.oracle())).toUint();
    }

    /// Opens an `auction`
    function _launchAuction(Auction.Info memory auction) internal {
        auctions.push(auction);
        auctions[auctions.length - 1].open(main.auctionPeriod(), main.market());
        emit IAuctioneer.AuctionStarted(
            auctions.length - 1,
            address(auctions[auctions.length - 1].sell),
            address(auctions[auctions.length - 1].buy),
            auctions[auctions.length - 1].sellAmount,
            auctions[auctions.length - 1].minBuyAmount,
            auctions[auctions.length - 1].fate
        );
        // _setMood(Mood.TRADING); TODO
    }
}
