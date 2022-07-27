// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

import "contracts/interfaces/IGnosis.sol";
import "contracts/interfaces/ITrade.sol";

import "contracts/fuzz/IFuzz.sol";
import "contracts/fuzz/TradeMock.sol";
import "contracts/fuzz/Utils.sol";

import "contracts/p1/AssetRegistry.sol";
import "contracts/p1/BackingManager.sol";
import "contracts/p1/BasketHandler.sol";
import "contracts/p1/Broker.sol";
import "contracts/p1/Distributor.sol";
import "contracts/p1/Furnace.sol";
import "contracts/p1/Main.sol";
import "contracts/p1/RToken.sol";
import "contracts/p1/RevenueTrader.sol";
import "contracts/p1/StRSR.sol";
import "contracts/plugins/mocks/ERC20Mock.sol";

// ================ Components ================
// Every component must override _msgSender() in this one, common way!

contract AssetRegistryP1Fuzz is AssetRegistryP1 {
    function _msgSender() internal view virtual override returns (address) {
        return IMainFuzz(address(main)).sender();
    }
}

contract BasketHandlerP1Fuzz is BasketHandlerP1 {
    function _msgSender() internal view virtual override returns (address) {
        return IMainFuzz(address(main)).sender();
    }
}

contract BackingManagerP1Fuzz is BackingManagerP1 {
    function _msgSender() internal view virtual override returns (address) {
        return IMainFuzz(address(main)).sender();
    }
}

contract BrokerP1Fuzz is BrokerP1 {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    function _openTrade(TradeRequest memory req) internal virtual override returns (ITrade) {
        TradeMock trade = new TradeMock();
        IERC20Upgradeable(address(req.sell.erc20())).safeTransferFrom(
            _msgSender(),
            address(trade),
            req.sellAmount
        );
        trade.init(IMainFuzz(address(main)), _msgSender(), auctionLength, req);
        return trade;
    }

    function _msgSender() internal view virtual override returns (address) {
        return IMainFuzz(address(main)).sender();
    }
}

contract DistributorP1Fuzz is DistributorP1 {
    function _msgSender() internal view virtual override returns (address) {
        return IMainFuzz(address(main)).sender();
    }
}

contract FurnaceP1Fuzz is FurnaceP1 {
    function _msgSender() internal view virtual override returns (address) {
        return IMainFuzz(address(main)).sender();
    }
}

contract RevenueTraderP1Fuzz is RevenueTraderP1 {
    function _msgSender() internal view virtual override returns (address) {
        return IMainFuzz(address(main)).sender();
    }
}

contract RTokenP1Fuzz is IRTokenFuzz, RTokenP1 {
    using FixLib for uint192;

    // To be called only from MarketMock; this only works if MarketMock never enqueues any other
    // issuances.
    function fastIssue(uint256 amtRToken) external notPausedOrFrozen {
        require(amtRToken > 0, "Cannot issue zero");
        issue(amtRToken);

        IssueQueue storage queue = issueQueues[_msgSender()];
        if (queue.right > queue.left) {
            // We pushed a slow issuance, so rewrite that to be available now, and then vest it.
            queue.items[queue.right - 1].when = 0;
            vestUpTo(_msgSender(), queue.right);
        }
    }

    /// The tokens and underlying quantities needed to issue `amount` qRTokens.
    /// @dev this is distinct from basketHandler().quote() b/c the input is in RTokens, not BUs.
    /// @param amount {qRTok} quantity of qRTokens to quote.
    function quote(uint256 amount, RoundingMode roundingMode)
        external
        view
        returns (address[] memory tokens, uint256[] memory amts)
    {
        uint192 baskets = (totalSupply() > 0)
            ? basketsNeeded.muluDivu(amount, totalSupply()) // {BU * qRTok / qRTok}
            : shiftl_toFix(amount, -int8(decimals())); // {qRTok / qRTok}

        return main.basketHandler().quote(baskets, roundingMode);
    }

    function _msgSender() internal view virtual override returns (address) {
        return IMainFuzz(address(main)).sender();
    }
}

contract StRSRP1Fuzz is StRSRP1 {
    function _msgSender() internal view virtual override returns (address) {
        return IMainFuzz(address(main)).sender();
    }
}

// ================ Main ================
contract MainP1Fuzz is IMainFuzz, MainP1 {
    address public sender;
    uint256 public seed;
    IMarketMock public marketMock;
    ERC20Mock[] public tokens;

    function setSender(address sender_) public {
        sender = sender_;
    }

    function setSeed(uint256 seed_) public {
        seed = seed_;
    }

    constructor(uint8 numTokens) {
        // Construct components
        rsr = new ERC20Mock("Reserve Rights", "RSR");
        rToken = new RTokenP1Fuzz();
        stRSR = new StRSRP1Fuzz();
        assetRegistry = new AssetRegistryP1Fuzz();
        basketHandler = new BasketHandlerP1Fuzz();
        backingManager = new BackingManagerP1Fuzz();
        distributor = new DistributorP1Fuzz();
        rsrTrader = new RevenueTraderP1Fuzz();
        rTokenTrader = new RevenueTraderP1Fuzz();
        furnace = new FurnaceP1Fuzz();
        broker = new BrokerP1Fuzz();
        for (uint8 i = 0; i < numTokens; i++) {
            string memory num = Strings.toString(i);
            tokens.push(new ERC20Mock(concat("Token ", num), concat("T_", num)));
        }
    }

    // Initialize self and components
    // Avoiding overloading here, just because it's super annoying to deal with in ethers.js
    function initFuzz(
        DeploymentParams memory params,
        uint32 freezerDuration,
        IMarketMock marketMock_
    ) public virtual initializer {
        // ==== Init self ====
        __Auth_init(freezerDuration);
        __UUPSUpgradeable_init();
        emit MainInitialized();

        // ==== Initialize components ====
        // This is pretty much the matching section from p1/Deployer.sol
        backingManager.init(
            this,
            params.tradingDelay,
            params.backingBuffer,
            params.maxTradeSlippage,
            params.dustAmount
        );

        basketHandler.init(this);
        rsrTrader.init(this, rsr, params.maxTradeSlippage, params.dustAmount);
        rTokenTrader.init(
            this,
            IERC20(address(rToken)),
            params.maxTradeSlippage,
            params.dustAmount
        );

        // Init Asset Registry
        assetRegistry.init(this, new IAsset[](0));

        // Init Distributor
        distributor.init(this, params.dist);

        // Init Furnace
        furnace.init(this, params.rewardPeriod, params.rewardRatio);

        // Init Broker
        // `tradeImplmentation` and `gnosis` are unused in BrokerP1Fuzz
        broker.init(this, IGnosis(address(0)), ITrade(address(0)), params.auctionLength);
    }
}
