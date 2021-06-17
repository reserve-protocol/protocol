pragma solidity 0.8.4;

import "./RToken.sol";
import "./interfaces/IAuctionManager.sol";

import "./zeppelin/token/ERC20/IERC20.sol";
import "./zeppelin/token/ERC20/SafeERC20.sol";

import "./libraries/AuctionPair.sol";

contract StreamingAuctions {
    using SafeERC20 for IERC20;

    RToken public override immutable RTOKEN;

    mapping(bytes32 => AuctionPair.Info) public pairs;

    constructor(address rToken_) {
        tToken = RToken(rToken_);
    }

    modifier updateRToken() {
        RTOKEN.update();
    }

    // Requires allowance set on `buyingToken`
    function depositQuantity(
        address sellingToken, 
        address buyingToken, 
        uint256 amount
    ) external override updateRToken {
        AuctionPair.Info storage pair = pairs.get(sellingToken, buyingToken);
        IERC20(pair.buyingToken).safeTransferFrom(_msgSender(), address(this), amount);
        pair.balances[_msgSender()] += amount;
    }

    function setOffer(
        address sellingToken, 
        address buyingToken,
        uint256 offer
    ) external override {
        pairs.get(sellingToken, buyingToken).offers[_msgSender()] = offer;
    }

    function trade(
        address sellingToken, 
        address buyingToken, 
        uint256 sellingAmount
    ) external override {
        AuctionPair.Info storage pair = pairs.get(sellingToken, buyingToken);
        require(_msgSender() == address(RTOKEN), "only rToken can trade");

    }
}
