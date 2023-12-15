// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

import "contracts/plugins/mocks/ERC20Mock.sol";
import "contracts/plugins/trading/DutchTrade.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/interfaces/IBroker.sol";
import "contracts/interfaces/ITrade.sol";
import "contracts/fuzz/IFuzz.sol";
import "contracts/fuzz/Utils.sol";

contract GnosisTradeMock is ITrade {
    TradeKind public constant KIND = TradeKind.BATCH_AUCTION;

    IMainFuzz public main;

    IERC20Metadata public sell;
    IERC20Metadata public buy;
    uint256 public requestedSellAmt;
    uint256 public requestedBuyAmt;

    uint48 public endTime;
    address public origin;

    uint192 public sellAmount;

    enum GnosisTradeMockStatus {
        NOT_STARTED, // before init()
        OPEN, // after init(), before settle()
        CLOSED // after settle()
    }
    GnosisTradeMockStatus public status;

    function init(
        IMainFuzz main_,
        address origin_,
        uint48 batchAuctionLength,
        TradeRequest memory req
    ) external {
        require(status == GnosisTradeMockStatus.NOT_STARTED);
        status = GnosisTradeMockStatus.OPEN;

        main = main_;
        origin = origin_;
        endTime = uint48(block.timestamp) + batchAuctionLength;

        sell = req.sell.erc20();
        buy = req.buy.erc20();

        requestedSellAmt = req.sellAmount;
        requestedBuyAmt = req.minBuyAmount;

        sellAmount = shiftl_toFix(req.sellAmount, -int8(sell.decimals())); // {sellTok}
    }

    function canSettle() external view returns (bool) {
        return uint48(block.timestamp) >= endTime && status == GnosisTradeMockStatus.OPEN;
    }

    function settle() external returns (uint256 soldAmt, uint256 boughtAmt) {
        require(_msgSender() == origin, "only origin can settle");
        require(status == GnosisTradeMockStatus.OPEN, "trade not OPEN");
        require(uint48(block.timestamp) >= endTime, "trade not yet closed");
        status = GnosisTradeMockStatus.CLOSED;

        // ==== Trade tokens ====
        // Move tokens to-be-sold to the market mock
        sell.transfer(address(IMainFuzz(main).marketMock()), requestedSellAmt);
        // Have the "market" transform those tokens and send them back here
        uint256 actualBuyAmt = main.marketMock().execute(
            sell,
            buy,
            requestedSellAmt,
            requestedBuyAmt
        );

        // Report violation if required
        if (actualBuyAmt < requestedBuyAmt) {
            IBroker(address(main.broker())).reportViolation();
        }

        // Move the tokens to-be-bought to the original address
        buy.transfer(origin, actualBuyAmt);

        return (requestedSellAmt, actualBuyAmt);
    }

    function allowInstantSettlement() external {
        endTime = uint48(block.timestamp);
    }

    function _msgSender() internal view virtual returns (address) {
        return main.translateAddr(msg.sender);
    }
}

enum SettlingMode {
    Acceptable, // Provides an acceptable amount of tokens
    Random // Provides a random amount of tokens
}

// A simple external actor to "be the market", taking the other side of GnosisTradeMock trades.
contract MarketMock is IMarketMock {
    using FixLib for uint192;

    IMainFuzz public main;

    SettlingMode public mode;

    uint256[] public seeds;
    uint256 private index;

    constructor(IMainFuzz main_, SettlingMode mode_) {
        main = main_;
        mode = mode_;
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
    ) external returns (uint256) {
        address trader = _msgSender();

        if (address(sell) == address(main.rToken())) {
            vanishRTokens(sellAmt);
        } else {
            ERC20Mock(address(sell)).burn(address(this), sellAmt);
        }

        // Calculate buy amount
        uint256 actualBuyAmt = calculateActualBuyAmt(buy, buyAmt);

        if (address(buy) == address(main.rToken())) {
            procureRTokens(actualBuyAmt);
        } else {
            ERC20Mock(address(buy)).mint(address(this), actualBuyAmt);
        }

        buy.transfer(trader, actualBuyAmt);

        return actualBuyAmt;
    }

    // Add seed for randomness in trade settling - called by scenarios
    function pushSeed(uint256 seed) external {
        seeds.push(seed);
    }

    // Remove seed - called by scenarios
    function popSeed() external {
        if (seeds.length > 0) seeds.pop();
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
        rtoken.issue(rtokenAmt);

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

    function calculateActualBuyAmt(IERC20 buy, uint256 buyAmt) internal returns (uint256) {
        uint256 actualBuyAmt;

        // Get next seed to calculate the actual buy amt
        uint256 seed = getNextSeed();

        uint256 maxTradeSlippage = getMaxTradeSlippage(buy);

        uint256 lower;
        uint256 upper;
        if (mode == SettlingMode.Acceptable || (mode == SettlingMode.Random && seed % 5 > 0)) {
            // Acceptable prices
            if (buyAmt > 0) {
                lower = buyAmt;
                upper = ((buyAmt * FIX_ONE) / (FIX_ONE - maxTradeSlippage));
            } else {
                // Selling defaulted token, should get something valid in the Acceptable scenario
                lower = 1;
                upper = GNOSIS_MAX_TOKENS;
            }
        } else if (mode == SettlingMode.Random) {
            // Allow to cause a violation in some cases
            lower = 0;
            upper = GNOSIS_MAX_TOKENS + 1;
        } else revert("invalid settling mode");

        // set actual buy amount
        actualBuyAmt = between(lower, upper, seed);

        return actualBuyAmt;
    }

    // Gets the next seed to use, from the seeds array
    // if reaches the end of the list, starts again from the beginning
    function getNextSeed() internal returns (uint256) {
        uint256 seed = 0;
        if (seeds.length > 0) {
            if (index >= seeds.length) {
                index = 0;
            }
            seed = seeds[index];
            index++;
        }
        return seed;
    }

    function getMaxTradeSlippage(IERC20 buy) internal view returns (uint256) {
        uint192 maxTradeSlippage;
        if (address(buy) == address(main.rToken())) {
            // RTokenTrader
            maxTradeSlippage = ITrading(main.rTokenTrader()).maxTradeSlippage();
        } else if (address(buy) == address(main.rsr())) {
            // RSR Trader
            maxTradeSlippage = ITrading(main.rsrTrader()).maxTradeSlippage();
        } else {
            // Backing Manager
            maxTradeSlippage = ITrading(main.backingManager()).maxTradeSlippage();
        }
        return uint256(maxTradeSlippage);
    }

    function _msgSender() internal view virtual returns (address) {
        return main.translateAddr(msg.sender);
    }
}

contract DutchTradeP1Fuzz is DutchTrade {
    constructor() DutchTrade() {
        status = TradeStatus.NOT_STARTED; // mirror clone behavior
    }
}
