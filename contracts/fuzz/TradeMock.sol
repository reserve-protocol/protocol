// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

import "hardhat/console.sol";

import "contracts/plugins/mocks/ERC20Mock.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/interfaces/IBroker.sol";
import "contracts/interfaces/ITrade.sol";
import "contracts/fuzz/IFuzz.sol";

contract TradeMock is ITrade {
    IMainFuzz public main;

    IERC20Metadata public sell;
    IERC20Metadata public buy;
    uint256 public requestedSellAmt;
    uint256 public requestedBuyAmt;

    uint32 public endTime;
    address public origin;

    enum TradeMockStatus {
        NOT_STARTED, // before init()
        OPEN, // after init(), before settle()
        CLOSED // after settle()
    }
    TradeMockStatus public status;

    function init(
        IMainFuzz main_,
        address origin_,
        uint32 auctionLength,
        TradeRequest memory req
    ) external {
        require(status == TradeMockStatus.NOT_STARTED);
        status = TradeMockStatus.OPEN;

        main = main_;
        origin = origin_;
        endTime = uint32(block.timestamp) + auctionLength;

        sell = req.sell.erc20();
        buy = req.buy.erc20();

        requestedSellAmt = req.sellAmount;
        requestedBuyAmt = req.minBuyAmount;
    }

    function canSettle() external view returns (bool) {
        return uint32(block.timestamp) >= endTime && status == TradeMockStatus.OPEN;
    }

    function settle() external returns (uint256 soldAmt, uint256 boughtAmt) {
        require(_msgSender() == origin, "only origin can settle");
        require(status == TradeMockStatus.OPEN, "trade not OPEN");
        require(uint32(block.timestamp) >= endTime, "trade not yet closed");
        status = TradeMockStatus.CLOSED;

        // ==== Trade tokens ====
        // Move tokens to-be-sold to the market mock
        sell.transfer(address(IMainFuzz(main).marketMock()), requestedSellAmt);
        // Have the "market" transform those tokens and send them back here
        main.marketMock().execute(sell, buy, requestedSellAmt, requestedBuyAmt);

        // Move the tokens to-be-bought to the original address
        buy.transfer(origin, requestedBuyAmt);

        return (requestedSellAmt, requestedBuyAmt);
    }

    function _msgSender() internal view virtual returns (address) {
        return main.translateAddr(msg.sender);
    }
}

// A simple external actor to "be the market", taking the other side of TradeMock trades.
contract MarketMock is IMarketMock {
    IMainFuzz public main;

    constructor(IMainFuzz main_) {
        main = main_;
    }

    // execute expects the sell tokens to be already at MarketMock.
    // execute sends the buy tokens to `trader`.
    //
    // to make the simulation make sense, call this only from Trades
    //
    // sell + sellAmt: the amount MarketMock is vanishing from the Trader
    // buy + buyAmt: the amount MarketMock is procuring for the Trader
    function execute(
        IERC20 sell,
        IERC20 buy,
        uint256 sellAmt,
        uint256 buyAmt
    ) external {
        address trader = _msgSender();

        if (address(sell) == address(main.rToken())) {
            vanishRTokens(sellAmt);
        } else {
            ERC20Mock(address(sell)).burn(address(this), sellAmt);
        }

        if (address(buy) == address(main.rToken())) {
            procureRTokens(buyAmt);
        } else {
            ERC20Mock(address(buy)).mint(address(this), buyAmt);
        }

        buy.transfer(trader, buyAmt);
    }

    // Procure `amt` RTokens
    function procureRTokens(uint256 rtokenAmt) internal {
        IRTokenFuzz rtoken = IRTokenFuzz(address(main.rToken()));

        // Mint the backing tokens we'll need to issue the rtoken we want
        (address[] memory tokens, uint256[] memory amts) = rtoken.quote(rtokenAmt, CEIL);
        for (uint256 i = 0; i < tokens.length; i++) {
            ERC20Mock(tokens[i]).mint(address(this), amts[i]);
            ERC20Mock(tokens[i]).approve(address(rtoken), amts[i]);
        }

        // Issue the RToken we want
        rtoken.fastIssue(rtokenAmt);

        // Clean up any stray backing tokens
        for (uint256 i = 0; i < tokens.length; i++) {
            uint256 bal = ERC20Mock(tokens[i]).balanceOf(address(this));
            if (bal > 0) ERC20Mock(tokens[i]).burn(address(this), bal);
        }
    }

    function vanishRTokens(uint256 rtokenAmt) internal {
        IRTokenFuzz rtoken = IRTokenFuzz(address(main.rToken()));

        // Redeem these tokens
        rtoken.redeem(rtokenAmt);

        // Burn the backing tokens we received
        (address[] memory tokens, ) = rtoken.quote(rtokenAmt, FLOOR);
        for (uint256 i = 0; i < tokens.length; i++) {
            uint256 bal = ERC20Mock(tokens[i]).balanceOf(address(this));
            if (bal > 0) ERC20Mock(tokens[i]).burn(address(this), bal);
        }
    }

    function _msgSender() internal view virtual returns (address) {
        return main.translateAddr(msg.sender);
    }
}
