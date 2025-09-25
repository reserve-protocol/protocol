// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

import "contracts/interfaces/IAsset.sol";
import "contracts/interfaces/IDistributor.sol";
import "contracts/libraries/Fixed.sol";

import "contracts/fuzz/CollateralMock.sol";

import "contracts/fuzz/IFuzz.sol";
import "contracts/fuzz/AssetMock.sol";
import "contracts/fuzz/ERC20Fuzz.sol";
import "contracts/fuzz/PriceModel.sol";
import "contracts/fuzz/Trades.sol";
import "contracts/fuzz/Utils.sol";
import "contracts/fuzz/FuzzP1.sol";

import "contracts/fuzz/MainP1.sol";

// The "normal operations" fuzzing scenario, in which:
// - Tokens never default, or even threaten to default
// - The basket, once initialized, is never changed
// - No "significant" governance changes occur
contract NormalOpsScenario {
    using FixLib for uint192;

    // Assertion-failure event
    event AssertionFailure(string message);

    MainP1Fuzz public main;

    PriceModel internal volatile =
        PriceModel({ kind: Kind.Walk, curr: 1e18, low: 0.5e18, high: 2e18 });
    PriceModel internal stable =
        PriceModel({ kind: Kind.Band, curr: 1e18, low: 0.995e18, high: 1.005e18 });
    PriceModel internal growing =
        PriceModel({ kind: Kind.Walk, curr: 1e18, low: 1e18, high: 1.1e18 });
    PriceModel internal justOne = PriceModel({ kind: Kind.Constant, curr: 1e18, low: 0, high: 0 });

    IERC20[] public collateralTokens;
    IERC20[] public backupTokens;

    // Once constructed, everything is set up for random echidna runs to happen:
    // - main and its components are up
    // - standard tokens, and their Assets and Collateral, exist
    // - standard basket is configured
    // - at least one user has plenty of starting tokens
    constructor() {
        main = new MainP1Fuzz();

        main.initFuzz(defaultParams(), new MarketMock(main, SettlingMode.Acceptable));

        uint192 maxTradeVolume = defaultParams().rTokenMaxTradeVolume;

        // Create three "standard" collateral tokens; have rewards for the first two
        for (uint256 i = 0; i < 3; i++) {
            string memory num = Strings.toString(i);
            ERC20Fuzz token = new ERC20Fuzz(concat("Collateral ", num), concat("C", num), main);
            main.addToken(token);

            if (i < 2) {
                ERC20Fuzz reward = new ERC20Fuzz(concat("Reward ", num), concat("R", num), main);
                main.addToken(reward);
                main.assetRegistry().register(
                    new AssetMock(
                        IERC20Metadata(address(reward)),
                        maxTradeVolume,
                        604800, // priceTimeout
                        0.005e18, // oracleError
                        volatile // (price) model
                    )
                );
                token.setRewardToken(reward);
            }

            main.assetRegistry().register(
                new CollateralMock(
                    IERC20Metadata(address(token)),
                    maxTradeVolume,
                    604800, // priceTimeout
                    0.005e18, // oracleError
                    0.05e18, // defaultThreshold
                    86400, // delayUntilDefault
                    bytes32("USD"),
                    growing, // refPerTok model
                    justOne, // targetPerRef model
                    justOne, // uoaPerTarget model
                    stable, // deviation model,
                    uint192(i * 1e12) // 1/1,000,000 % hiding
                )
            );
            collateralTokens.push(IERC20(token));
        }

        // Create three "standard" backup USD tokens
        for (uint256 i = 0; i < 3; i++) {
            string memory num = Strings.toString(i);
            ERC20Fuzz token = new ERC20Fuzz(concat("Stable USD ", num), concat("USD", num), main);
            main.addToken(token);

            main.assetRegistry().register(
                new CollateralMock(
                    IERC20Metadata(address(token)),
                    maxTradeVolume,
                    604800, // priceTimeout
                    0.005e18, // oracleError
                    5e16, // defaultThreshold
                    86400, // delayUntilDefault
                    bytes32("USD"),
                    justOne,
                    stable,
                    justOne,
                    justOne,
                    uint192(i * 1e12) // 1/1,000,000 % hiding
                )
            );
            backupTokens.push(IERC20(token));
        }

        // Configure basket
        uint192[] memory wts = new uint192[](3);
        wts[0] = 0.5e18;
        wts[1] = 0.3e18;
        wts[2] = 0.2e18;
        main.basketHandler().setPrimeBasket(collateralTokens, wts);
        main.basketHandler().setBackupConfig(bytes32("USD"), 3, backupTokens);
        main.basketHandler().refreshBasket();

        // Add a few users and give them initial tokens
        for (uint256 u = 1; u <= 3; u++) {
            address user = address(uint160(u * 0x10000));
            main.addUser(user);
            ERC20Fuzz(address(main.rsr())).mint(user, 1e24);
            for (uint256 t = 0; t < main.numTokens(); t++) {
                ERC20Fuzz(address(main.tokens(t))).mint(user, 1e24);
            }
        }

        // Complete deployment by unfreezing
        main.assetRegistry().refresh();
        main.unfreeze();

        // Grant max allowances from BackingManager for RToken
        for (uint256 t = 0; t < main.numTokens(); t++) {
            main.backingManager().grantRTokenAllowance(main.tokens(t));
        }

        // Save RSR and RToken rates
        saveRates();
    }

    // In the modified function, send transactions from *this* contract as if they were from
    // msg.sender, which is presumably the echdina-chosen user.
    modifier asSender() {
        main.spoof(address(this), msg.sender);
        _;
        main.unspoof(address(this));
    }

    // ================ mutators ================

    // ==== user functions: token ops ====
    function transfer(
        uint8 userID,
        uint8 tokenID,
        uint256 amount
    ) public asSender {
        IERC20Metadata token = IERC20Metadata(address(main.someToken(tokenID)));
        token.transfer(main.someAddr(userID), amount);
    }

    function approve(
        uint8 spenderID,
        uint8 tokenID,
        uint256 amount
    ) public asSender {
        IERC20 token = main.someToken(tokenID);
        token.approve(main.someAddr(spenderID), amount);
    }

    function transferFrom(
        uint8 fromID,
        uint8 toID,
        uint8 tokenID,
        uint256 amount
    ) public asSender {
        IERC20 token = main.someToken(tokenID);
        token.transferFrom(main.someAddr(fromID), main.someAddr(toID), amount);
    }

    function mint(
        uint8 userID,
        uint8 tokenID,
        uint256 amount
    ) public {
        IERC20Metadata token = IERC20Metadata(address(main.someToken(tokenID)));
        require(
            address(token) != address(main.rToken()) && address(token) != address(main.stRSR()),
            "Do not just mint RTokens/StRSR"
        );
        ERC20Fuzz(address(token)).mint(main.someUser(userID), amount);
        require(token.totalSupply() <= 1e57, "Do not mint 'unreasonably' many tokens");
    }

    function burn(
        uint8 userID,
        uint8 tokenID,
        uint256 amount
    ) public {
        IERC20 token = main.someToken(tokenID);
        require(
            address(token) != address(main.rToken()) && address(token) != address(main.stRSR()),
            "Do not just burn RTokens/StRSR"
        );
        ERC20Fuzz(address(token)).burn(main.someUser(userID), amount);
    }

    // do issuance without doing allowances first
    function justIssue(uint256 amount) public asSender {
        _saveRTokenRate();

        main.rToken().issue(amount);

        // workaround: disable rate fall check if this is a mint starting at 0 supply
        if( main.rToken().totalSupply() == amount ) {
            _saveRTokenRate();
        }
    }

    // do allowances as needed, and *then* do issuance
    function issue(uint256 amount) public asSender {
        _saveRTokenRate();

        uint256 preSupply = main.rToken().totalSupply();
        require(amount + preSupply <= 1e48, "Do not issue 'unreasonably' many rTokens");

        address[] memory tokens;
        uint256[] memory tokenAmounts;
        (tokens, tokenAmounts) = (RTokenP1Fuzz(address(main.rToken()))).quote(amount, CEIL);
        for (uint256 i = 0; i < tokens.length; i++) {
            IERC20(tokens[i]).approve(address(main.rToken()), tokenAmounts[i]);
        }
        main.rToken().issue(amount);

        // workaround: disable rate fall check if this is a mint starting at 0 supply
        if( main.rToken().totalSupply() == amount ) {
            _saveRTokenRate();
        }
    }

    // do issuance without doing allowances first, to a different recipient
    function justIssueTo(uint256 amount, uint8 recipientID) public asSender {
        _saveRTokenRate();

        address recipient = main.someAddr(recipientID);

        main.rToken().issueTo(recipient, amount);

        // workaround: disable rate fall check if this is a mint starting at 0 supply
        if( main.rToken().totalSupply() == amount ) {
            _saveRTokenRate();
        }
    }

    // do allowances as needed, and *then* do issuance
    function issueTo(uint256 amount, uint8 recipientID) public asSender {
        _saveRTokenRate();
        address recipient = main.someAddr(recipientID);
        uint256 preSupply = main.rToken().totalSupply();
        require(amount + preSupply <= 1e48, "Do not issue 'unreasonably' many rTokens");

        address[] memory tokens;
        uint256[] memory tokenAmounts;
        (tokens, tokenAmounts) = (RTokenP1Fuzz(address(main.rToken()))).quote(amount, CEIL);
        for (uint256 i = 0; i < tokens.length; i++) {
            IERC20(tokens[i]).approve(address(main.rToken()), tokenAmounts[i]);
        }
        main.rToken().issueTo(recipient, amount);

        // workaround: disable rate fall check if this is a mint starting at 0 supply
        if( main.rToken().totalSupply() == amount ) {
            _saveRTokenRate();
        }
    }

    function redeem(uint256 amount) public asSender {
        _saveRTokenRate();
        main.rToken().redeem(amount);
    }

    function redeemTo(uint256 amount, uint8 recipientID) public asSender {
        _saveRTokenRate();
        address recipient = main.someAddr(recipientID);
        main.rToken().redeemTo(recipient, amount);
    }

    uint48[] internal redeemableBasketNonces;
    uint192[] internal redeemablePortions;
    uint192 internal totalPortions;

    function pushRedeemableBasketNonce(uint256 portionSeed) public {
        redeemableBasketNonces.push(main.basketHandler().nonce());
        uint192 portion = uint192(between(0, 1e18, portionSeed));
        totalPortions += portion;
        redeemablePortions.push(portion);
    }

    function redeemCustom(uint8 recipientID, uint192 amount) public asSender {
        _saveRTokenRate();
        address recipient = main.someAddr(recipientID);
        uint192[] memory portions = new uint192[](redeemablePortions.length);

        for (uint256 i = 0; i < redeemablePortions.length; i++) {
            portions[i] = (redeemablePortions[i] * 1e18) / totalPortions;
        }

        (address[] memory erc20sOut, uint256[] memory amountsOut) = main
        .basketHandler()
        .quoteCustomRedemption(redeemableBasketNonces, portions, amount);

        main.rToken().redeemCustom(
            recipient,
            amount,
            redeemableBasketNonces,
            portions,
            erc20sOut,
            amountsOut
        );
    }

    function monetizeDonations(uint8 tokenID) public {
        IERC20 erc20 = main.someToken(tokenID);
        TestIRToken(address(main.rToken())).monetizeDonations(erc20);
    }

    // ==== user functions: strsr ====
    function justStake(uint256 amount) public asSender {
        main.stRSR().stake(amount);
    }

    function stake(uint256 amount) public asSender {
        main.rsr().approve(address(main.stRSR()), amount);
        main.stRSR().stake(amount);
    }

    function unstake(uint256 amount) public asSender {
        main.stRSR().unstake(amount);
    }

    function cancelUnstake(uint256 endIdSeed) public asSender {
        StRSRP1Fuzz strsr = StRSRP1Fuzz(address(main.stRSR()));
        uint256 len = strsr.draftQueueLen(strsr.getDraftEra(), msg.sender);
        uint256 id = between(0, len, endIdSeed);
        strsr.cancelUnstake(id);
    }

    function withdraw(uint256 seedAddr, uint256 seedID) public asSender {
        address user = main.someAddr(seedAddr);
        (uint256 left, uint256 right) = StRSRP1Fuzz(address(main.stRSR())).idRange(user);
        uint256 id = between(left == 0 ? 0 : left - 1, right + 1, seedID);
        main.stRSR().withdraw(user, id);
    }

    function withdrawAvailable() public asSender {
        address user = msg.sender;
        uint256 id = main.stRSR().endIdForWithdraw(user);
        main.stRSR().withdraw(user, id);
    }

    // ==== keeper functions ====
    function updatePrice(
        uint256 seedID,
        uint192 a,
        uint192 b,
        uint192 c,
        uint192 d
    ) public {
        IERC20 erc20 = main.someToken(seedID);
        IAssetRegistry reg = main.assetRegistry();
        if (!reg.isRegistered(erc20)) return;
        IAsset asset = reg.toAsset(erc20);
        if (asset.isCollateral()) {
            CollateralMock(address(asset)).update(a, b, c, d);
        } else {
            AssetMock(address(asset)).update(a);
        }
    }

    // update reward amount
    function updateRewards(uint256 seedID, uint256 a) public {
        IERC20 erc20 = main.someToken(seedID);
        IAssetRegistry reg = main.assetRegistry();
        if (!reg.isRegistered(erc20)) return;

        ERC20Fuzz(address(erc20)).setRewardAmount(a);
    }

    function claimRewards(uint8 which) public {
        which %= 3;
        if (which == 0) main.rTokenTrader().claimRewards();
        else if (which == 1) main.rsrTrader().claimRewards();
        else if (which == 2) main.backingManager().claimRewards();
    }

    function pushSeedForTrades(uint256 seed) public {
        IMarketMock(address(main.marketMock())).pushSeed(seed);
    }

    function popSeedForTrades() public {
        IMarketMock(address(main.marketMock())).popSeed();
    }

    function settleTrades() public {
        BrokerP1Fuzz(address(main.broker())).settleTrades();
    }

    IERC20[] internal backingToManage;

    function pushBackingToManage(uint256 tokenID) public {
        backingToManage.push(main.someToken(tokenID));
    }

    function popBackingToManage() public {
        if (backingToManage.length > 0) backingToManage.pop();
    }

    function rebalance(uint256 kindSeed) public {
        main.backingManager().rebalance(TradeKind(kindSeed % 2));
    }

    function forwardRevenue() public {
        main.backingManager().forwardRevenue(backingToManage);
    }

    function manageTokenInRSRTrader(uint256 tokenID, uint256 kindSeed) public {
        IERC20[] memory tokens = new IERC20[](1);
        tokens[0] = main.someToken(tokenID);
        TradeKind[] memory tradeKinds = new TradeKind[](1);
        tradeKinds[0] = TradeKind(kindSeed % 2);
        main.rsrTrader().manageTokens(tokens, tradeKinds);
    }

    function manageTokenInRTokenTrader(uint256 tokenID, uint256 kindSeed) public {
        IERC20[] memory tokens = new IERC20[](1);
        tokens[0] = main.someToken(tokenID);
        TradeKind[] memory tradeKinds = new TradeKind[](1);
        tradeKinds[0] = TradeKind(kindSeed % 2);
        main.rTokenTrader().manageTokens(tokens, tradeKinds);
    }

    function grantAllowances(uint256 tokenID) public {
        main.backingManager().grantRTokenAllowance(main.someToken(tokenID));
    }

    // do revenue distribution without doing allowances first
    function justDistributeRevenue(
        uint256 tokenID,
        uint8 fromID,
        uint256 amount
    ) public asSender {
        IERC20 token = main.someToken(tokenID);
        // distribute now uses msg.sender (2/1/23), so spoof from caller
        address fromUser = main.someAddr(fromID);
        main.spoof(address(this), fromUser);
        main.distributor().distribute(token, amount);
        main.unspoof(address(this));
    }

    // do revenue distribution granting allowance first - only RSR or RToken
    function distributeRevenue(
        uint8 which,
        uint8 fromID,
        uint256 amount
    ) public {
        IERC20 token;

        which %= 2;
        if (which == 0) token = IERC20(address(main.rsr()));
        else token = IERC20(address(main.rToken()));

        // Grant allowances from fromID
        address fromUser = main.someAddr(fromID);
        main.spoof(address(this), fromUser);
        token.approve(address(main.distributor()), amount);
        main.distributor().distribute(token, amount);
        main.unspoof(address(this));
    }

    function distributeTokenToBuy(uint8 which) public {
        IERC20 token;

        which %= 2;
        if (which == 0) {
            main.rsrTrader().distributeTokenToBuy();
        } else {
            main.rTokenTrader().distributeTokenToBuy();
        }
    }

    function returnTokens(uint8 which) public {
        which %= 2;
        if (which == 0) {
            main.rsrTrader().returnTokens(backingToManage);
        } else {
            main.rTokenTrader().returnTokens(backingToManage);
        }
    }

    function payRSRProfits() public {
        main.stRSR().payoutRewards();
    }

    function payRTokenProfits() public {
        main.furnace().melt();
        assertFurnacePayouts();
    }

    function cacheComponents() public {
        BackingManagerP1(address(main.backingManager())).cacheComponents();
        DistributorP1(address(main.distributor())).cacheComponents();
        RevenueTraderP1(address(main.rsrTrader())).cacheComponents();
        RevenueTraderP1(address(main.rTokenTrader())).cacheComponents();
        BrokerP1(address(main.broker())).cacheComponents();
    }

    function trackBasketStatus() public {
        BasketHandlerP1(address(main.basketHandler())).trackStatus();
    }

    // ==== governance changes ====
    function setIssuanceThrottleParams(uint256 amtRateSeed, uint256 pctRateSeed) public {
        RTokenP1Fuzz rToken = RTokenP1Fuzz(address(main.rToken()));
        uint256 amtRate = between(
            rToken.MIN_THROTTLE_RATE_AMT(),
            rToken.MAX_THROTTLE_RATE_AMT(),
            amtRateSeed
        );
        uint256 pctRate = between(0, rToken.MAX_THROTTLE_PCT_AMT(), pctRateSeed);
        ThrottleLib.Params memory tParams = ThrottleLib.Params(amtRate, _safeWrap(pctRate));
        RTokenP1Fuzz(address(main.rToken())).setIssuanceThrottleParams(tParams);
    }

    function setRedemptionThrottleParams(uint256 amtRateSeed, uint256 pctRateSeed) public {
        RTokenP1Fuzz rToken = RTokenP1Fuzz(address(main.rToken()));
        uint256 amtRate = between(
            rToken.MIN_THROTTLE_RATE_AMT(),
            rToken.MAX_THROTTLE_RATE_AMT(),
            amtRateSeed
        );
        uint256 pctRate = between(0, rToken.MAX_THROTTLE_PCT_AMT(), pctRateSeed);
        ThrottleLib.Params memory tParams = ThrottleLib.Params(amtRate, _safeWrap(pctRate));
        RTokenP1Fuzz(address(main.rToken())).setRedemptionThrottleParams(tParams);
    }

    function setDistribution(
        uint256 seedID,
        uint16 rTokenDist,
        uint16 rsrDist
    ) public {
        RevenueShare memory dist = RevenueShare(rTokenDist, rsrDist);
        main.distributor().setDistribution(main.someAddr(seedID), dist);
    }

    function setBackingBuffer(uint256 seed) public {
        BackingManagerP1(address(main.backingManager())).setBackingBuffer(
            uint192(between(0, 1e18, seed))
        ); // 1e18 == MAX_BACKING_BUFFER
    }

    function setBackingManagerTradingDelay(uint256 seed) public {
        BackingManagerP1(address(main.backingManager())).setTradingDelay(
            uint48(between(0, 31536000, seed))
        ); // 31536000 is BackingManager.MAX_TRADING_DELAY
    }

    function setBatchAuctionLength(uint256 seed) public {
        BrokerP1(address(main.broker())).setBatchAuctionLength(uint48(between(1, 604800, seed)));
        // 604800 is Broker.MAX_AUCTION_LENGTH
    }

    function setDutchAuctionLength(uint256 seed) public {
        BrokerP1(address(main.broker())).setDutchAuctionLength(uint48(between(1, 604800, seed)));
        // 604800 is Broker.MAX_AUCTION_LENGTH
    }

    function setFurnaceRatio(uint256 seed) public {
        FurnaceP1(address(main.furnace())).setRatio(uint192(between(0, 1e14, seed)));
        // 1e14 is Furnace.MAX_RATIO
    }

    function setRSRTraderMaxTradeSlippage(uint256 seed) public {
        RevenueTraderP1(address(main.rsrTrader())).setMaxTradeSlippage(
            uint192(between(0, 1e18, seed))
        );
        // 1e18 is Trading.MAX_TRADE_SLIPPAGE
    }

    function setRSRTraderMinTradeVolume(uint256 seed) public {
        RevenueTraderP1(address(main.rsrTrader())).setMinTradeVolume(
            uint192(between(0, 1e29, seed))
        ); // 1e29 is Trading.MAX_TRADE_VOLUME
    }

    function setRTokenTraderMaxTradeSlippage(uint256 seed) public {
        RevenueTraderP1(address(main.rTokenTrader())).setMaxTradeSlippage(
            uint192(between(0, 1e18, seed))
        );
        // 1e18 is Trading.MAX_TRADE_SLIPPAGE
    }

    function setRTokenTraderMinTradeVolume(uint256 seed) public {
        RevenueTraderP1(address(main.rTokenTrader())).setMinTradeVolume(
            uint192(between(0, 1e29, seed))
        ); // 1e29 is Trading.MAX_TRADE_VOLUME
    }

    function setBackingManagerMaxTradeSlippage(uint256 seed) public {
        BackingManagerP1(address(main.backingManager())).setMaxTradeSlippage(
            uint192(between(0, 1e18, seed))
        );
        // 1e18 is Trading.MAX_TRADE_SLIPPAGE
    }

    function setBackingManagerMinTradeVolume(uint256 seed) public {
        BackingManagerP1(address(main.backingManager())).setMinTradeVolume(
            uint192(between(0, 1e29, seed))
        ); // 1e29 is Trading.MAX_TRADE_VOLUME
    }

    function setStakeRewardRatio(uint256 seed) public {
        StRSRP1(address(main.stRSR())).setRewardRatio(uint192(between(0, 1e14, seed)));
    }

    function setUnstakingDelay(uint256 seed) public {
        StRSRP1(address(main.stRSR())).setUnstakingDelay(uint48(between(1, 31536000, seed)));
    }

    function setWithdrawalLeak(uint256 seed) public {
        StRSRP1(address(main.stRSR())).setWithdrawalLeak(uint48(between(0, 3e17, seed)));
    }

    function setWarmupPeriod(uint256 seed) public {
        BasketHandlerP1(address(main.basketHandler())).setWarmupPeriod(
            uint48(between(60, 31536000, seed))
        );
    }

    function setIssuancePremiumEnabled(uint256 seed) public {
        BasketHandlerP1(address(main.basketHandler())).setIssuancePremiumEnabled((seed % 2) == 0);
    }

    function resetStakes() public {
        main.stRSR().resetStakes();
    }

    // ================ System Properties ================

    // The system is always fully collateralized
    function echidna_isFullyCollateralized() external view returns (bool) {
        return main.basketHandler().fullyCollateralized();
    }

    // The system is always fully collateralized (implemented a little more manually)
    function echidna_quoteProportionalToBasket() external view returns (bool) {
        // rtoken.quote() * rtoken.totalSupply < basketHolder balances
        RTokenP1Fuzz rtoken = RTokenP1Fuzz(address(main.rToken()));
        (address[] memory tokens, uint256[] memory amts) = rtoken.quote(
            rtoken.totalSupply(),
            RoundingMode.FLOOR
        );

        for (uint256 i = 0; i < tokens.length; i++) {
            uint256 bal = IERC20(tokens[i]).balanceOf(address(main.backingManager()));
            if (bal < amts[i]) return false;
        }
        return true;
    }

    // Calling basketHandler.refereshBasket() yields an identical basket.
    function echidna_refreshBasketIsNoop() external returns (bool) {
        assert(main.hasRole(OWNER, address(this)));
        BasketHandlerP1Fuzz bh = BasketHandlerP1Fuzz(address(main.basketHandler()));
        bh.savePrev();
        bh.refreshBasket();
        return bh.prevEqualsCurr();
    }

    // RSR and RToken rates never fall
    uint192 public prevRSRRate; // {RSR/stRSR}
    uint192 public prevRTokenRate; // {BU/RTok}

    function rTokenRate() public view returns (uint192) {
        return
            main.rToken().totalSupply() == 0
                ? FIX_ONE
                : uint192((FIX_ONE * main.rToken().basketsNeeded()) / main.rToken().totalSupply());
    }

    // pseudo-mutator for saving old rates...
    function saveRates() public {
        prevRSRRate = main.stRSR().exchangeRate();
        _saveRTokenRate();
    }

    function _saveRTokenRate() internal {
        prevRTokenRate = rTokenRate();
    }

    function assertFurnacePayouts() public view {
        FurnaceP1Fuzz(address(main.furnace())).assertPayouts();
    }

    // this check is disabled after issuance operations (valid counterexample)
    function echidna_ratesNeverFall() external view returns (bool) {
        if (main.stRSR().exchangeRate() < prevRSRRate) return false;
        if (main.rToken().totalSupply() > 0 && rTokenRate() < prevRTokenRate) return false;
        return true;
    }

    function echidna_mainInvariants() external view returns (bool) {
        return main.invariantsHold();
    }

    function echidna_assetRegistryInvariants() external view returns (bool) {
        return AssetRegistryP1Fuzz(address(main.assetRegistry())).invariantsHold();
    }

    function echidna_backingManagerInvariants() external view returns (bool) {
        return BackingManagerP1Fuzz(address(main.backingManager())).invariantsHold();
    }

    function echidna_basketInvariants() external view returns (bool) {
        return BasketHandlerP1Fuzz(address(main.basketHandler())).invariantsHold();
    }

    function echidna_brokerInvariants() external view returns (bool) {
        return BrokerP1Fuzz(address(main.broker())).invariantsHold();
    }

    // Calling basketHandler.refreshBasket() provides some properties
    function echidna_refreshBasketProperties() external returns (bool) {
        assert(main.hasRole(OWNER, address(this)));
        BasketHandlerP1Fuzz bh = BasketHandlerP1Fuzz(address(main.basketHandler()));
        bh.savePrev();
        bh.refreshBasket();
        return bh.isValidBasketAfterRefresh();
    }

    function echidna_distributorInvariants() external view returns (bool) {
        return DistributorP1Fuzz(address(main.distributor())).invariantsHold();
    }

    function echidna_furnaceInvariants() external view returns (bool) {
        return FurnaceP1Fuzz(address(main.furnace())).invariantsHold();
    }

    function echidna_rsrTraderInvariants() external view returns (bool) {
        return RevenueTraderP1Fuzz(address(main.rsrTrader())).invariantsHold();
    }

    function echidna_rTokenTraderInvariants() external view returns (bool) {
        return RevenueTraderP1Fuzz(address(main.rTokenTrader())).invariantsHold();
    }

    /* deprecated 3.0.0
    *
    function echidna_rTokenInvariants() external view returns (bool) {
        return RTokenP1Fuzz(address(main.rToken())).invariantsHold();
    }
    *
    */

    function echidna_stRSRInvariants() external view returns (bool) {
        return StRSRP1Fuzz(address(main.stRSR())).invariantsHold();
    }
}
