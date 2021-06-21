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

    // Requires allowance set on `buyingToken`
    function depositQuantity(
        address sellingToken, 
        address buyingToken, 
        uint256 amount
    ) external {
        AuctionPair.Info storage pair = pairs.get(sellingToken, buyingToken);
        IERC20(pair.buyingToken).safeTransferFrom(_msgSender(), address(this), amount);
        pair.balances[_msgSender()] += amount;
    }

    function setOffer(
        address sellingToken, 
        address buyingToken,
        uint256 offer
    ) external {
        pairs.get(sellingToken, buyingToken).offers[_msgSender()] = offer;
    }

    function trade(
        address sellingToken, 
        address buyingToken, 
        uint256 sellingAmount
    ) external override {
        AuctionPair.Info storage pair = pairs.get(sellingToken, buyingToken);

    }
    function trade(
        address sellingToken, 
        address buyingToken, 
        uint256 sellingAmount,
        uint256 minBuyingAmountWouldAccept
    ) external override {
        AuctionPair.Info storage pair = pairs.get(sellingToken, buyingToken);
        //TODO
    }
}
