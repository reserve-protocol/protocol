// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "../interfaces/IAtomicExchange.sol";

import "../zeppelin/utils/Context.sol";
import "../zeppelin/token/ERC20/IERC20.sol";
import "../zeppelin/token/ERC20/utils/SafeERC20.sol";

import "../libraries/AuctionPair.sol";

contract SimpleOrderbookExchange is Context, IAtomicExchange {
    using AuctionPair for mapping(bytes32 => AuctionPair.Info);
    using SafeERC20 for IERC20;

    mapping(bytes32 => AuctionPair.Info) public pairs;

    // Requires allowance set on `buyToken`
    function depositQuantity(
        address sellToken, 
        address buyToken, 
        uint256 amount
    ) external {
        AuctionPair.Info storage pair = pairs.get(sellToken, buyToken);
        IERC20(pair.buyToken).safeTransferFrom(_msgSender(), address(this), amount);
        pair.balances[_msgSender()] += amount;
    }

    function setOffer(
        address sellToken, 
        address buyToken,
        uint256 offer
    ) external {
        pairs.get(sellToken, buyToken).offers[_msgSender()] = offer;
    }

    function tradeFixedSell(
        address sellToken, 
        address buyToken, 
        uint256 sellAmount,
        uint256 minBuyAmount
    ) external override {
        AuctionPair.Info storage pair = pairs.get(sellToken, buyToken);
        //TODO
    }

    function tradeFixedBuy(
        address sellToken, 
        address buyToken, 
        uint256 buyAmount,
        uint256 maxSellAmount
    ) external override {
        AuctionPair.Info storage pair = pairs.get(sellToken, buyToken);
        //TODO
    }

}
