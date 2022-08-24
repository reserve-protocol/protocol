// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/utils/Strings.sol";

import "contracts/interfaces/IAsset.sol";
import "contracts/interfaces/IDistributor.sol";
import "contracts/libraries/Fixed.sol";

import "contracts/fuzz/IFuzz.sol";
import "contracts/fuzz/CollateralMock.sol";
import "contracts/fuzz/ERC20Fuzz.sol";
import "contracts/fuzz/PriceModel.sol";
import "contracts/fuzz/TradeMock.sol";
import "contracts/fuzz/Utils.sol";

import "contracts/fuzz/FuzzP1.sol";

// The "normal operations" fuzzing scenario, in which:
// - Tokens never default, or even threaten to default
// - The basket, once initialized, is never changed
// - No "significant" governance changes occur
contract NormalOpsScenario {
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

        main.initFuzz(defaultParams(), defaultFreezeDuration(), new MarketMock(main));

        TradingRange memory tradingRange = defaultParams().tradingRange;

        // Create three "standard" collateral tokens; have rewards for the first two
        for (uint256 i = 0; i < 3; i++) {
            string memory num = Strings.toString(i);
            ERC20Fuzz token = new ERC20Fuzz(concat("Collateral ", num), concat("C", num), main);
            main.addToken(token);

            IERC20Metadata reward;
            if (i < 2) {
                reward = new ERC20Fuzz(concat("Reward ", num), concat("R", num), main);
                main.addToken(reward);
                main.assetRegistry().register(
                    new AssetMock(
                        IERC20Metadata(address(reward)),
                        IERC20Metadata(address(0)), // no recursive reward
                        tradingRange,
                        volatile
                    )
                );
            } else {
                reward = IERC20Metadata(address(0));
            }

            main.assetRegistry().register(
                new CollateralMock(
                    IERC20Metadata(address(token)),
                    reward,
                    tradingRange,
                    0,
                    0,
                    IERC20Metadata(address(0)),
                    bytes32("USD"),
                    growing,
                    stable,
                    justOne,
                    stable
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
                    IERC20Metadata(address(0)), // no reward
                    tradingRange,
                    0,
                    0,
                    IERC20Metadata(address(0)),
                    bytes32("USD"),
                    justOne,
                    stable,
                    justOne,
                    justOne
                )
            );
            backupTokens.push(IERC20(token));
        }

        // Create and assign /two/ reward tokens with volatile prices; leave the third unrewarding
        for (uint256 i = 0; i < 2; i++) {
            string memory num = Strings.toString(i);
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
        require(address(token) != address(main.rToken()), "Do not just mint RTokens");
        ERC20Fuzz(address(token)).mint(main.someUser(userID), amount);
        require(token.totalSupply() <= 1e57, "Do not mint 'unreasonably' many tokens");
    }

    function burn(
        uint8 userID,
        uint8 tokenID,
        uint256 amount
    ) public {
        IERC20 token = main.someToken(tokenID);
        require(address(token) != address(main.rToken()), "Do not just mint RTokens");
        ERC20Fuzz(address(token)).burn(main.someUser(userID), amount);
    }

    // ==== user functions: rtoken ====
    // do issuance without doing allowances first
    function justIssue(uint256 amount) public asSender {
        main.rToken().issue(amount);
    }

    // do allowances as needed, and *then* do issuance
    function issue(uint256 amount) public asSender {
        require(
            amount + main.rToken().totalSupply() <= 1e48,
            "Do not issue 'unreasonably' many rTokens"
        );
        address[] memory tokens;
        uint256[] memory tokenAmounts;
        (tokens, tokenAmounts) = (RTokenP1Fuzz(address(main.rToken()))).quote(amount, CEIL);
        for (uint256 i = 0; i < tokens.length; i++) {
            IERC20(tokens[i]).approve(address(main.rToken()), tokenAmounts[i]);
        }

        main.rToken().issue(amount);
    }

    function cancelIssuance(uint256 seedID, bool earliest) public asSender {
        // filter endIDs mostly to valid IDs
        address user = msg.sender;
        RTokenP1Fuzz rtoken = RTokenP1Fuzz(address(main.rToken()));
        (uint256 left, uint256 right) = rtoken.idRange(user);
        uint256 id = between(left == 0 ? 0 : left - 1, right + 1, seedID);

        // Do cancel
        rtoken.cancel(id, earliest);
    }

    function vestIssuance(uint256 seedID) public asSender {
        // filter endIDs mostly to valid IDs
        address user = msg.sender;
        RTokenP1Fuzz rtoken = RTokenP1Fuzz(address(main.rToken()));
        (uint256 left, ) = rtoken.idRange(user);
        uint256 endIDForVest = rtoken.endIdForVest(user);
        uint256 id = between(left == 0 ? 0 : left - 1, endIDForVest + 1, seedID);

        // Do vest
        rtoken.vest(user, id);
    }

    function redeem(uint256 amount) public asSender {
        main.rToken().redeem(amount);
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
        AssetMock asset = AssetMock(address(reg.toAsset(erc20)));
        asset.updateRewardAmount(a);
        // same signature on CollateralMock. Could define a whole interface, but eh
    }

    function claimProtocolRewards(uint8 which) public {
        which %= 4;
        if (which == 0) main.rTokenTrader().claimAndSweepRewards();
        else if (which == 1) main.rsrTrader().claimAndSweepRewards();
        else if (which == 2) main.backingManager().claimAndSweepRewards();
        else if (which == 3) main.rToken().claimAndSweepRewards();
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

    function manageBackingTokens() public {
        main.backingManager().manageTokens(backingToManage);
    }

    function grantAllowances(uint256 tokenID) public {
        main.backingManager().grantRTokenAllowance(main.someToken(tokenID));
    }

    function payRSRProfits() public {
        main.stRSR().payoutRewards();
    }

    function payRTokenProfits() public {
        main.furnace().melt();
    }

    // ==== governance changes ====
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
            uint192(between(seed, 0, 1e18))
        ); // 1e18 == MAX_BACKING_BUFFER
    }

    function setBackingManagerTradingDelay(uint256 seed) public {
        BackingManagerP1(address(main.backingManager())).setTradingDelay(
            uint32(between(seed, 0, 31536000))
        ); // 31536000 is BackingManager.MAX_TRADING_DELAY
    }

    function setAuctionLength(uint256 seed) public {
        BrokerP1(address(main.broker())).setAuctionLength(uint32(between(seed, 1, 604800)));
        // 604800 is Broker.MAX_AUCTION_LENGTH
    }

    function setFurnacePeriod(uint256 seed) public {
        FurnaceP1(address(main.furnace())).setPeriod(uint32(between(seed, 1, 31536000)));
        // 31536000 is Furnace.MAX_PERIOD
    }

    function setFurnaceRatio(uint256 seed) public {
        FurnaceP1(address(main.furnace())).setRatio(uint192(between(seed, 0, 1e18)));
        // 1e18 is Furnace.MAX_RATIO
    }

    function setIssuanceRate(uint256 seed) public {
        RTokenP1(address(main.rToken())).setIssuanceRate(uint192(between(seed, 0, 1e18)));
        // 1e18 is RToken.MAX_ISSUANCE_RATE
    }

    function setRSRTraderMaxTradeSlippage(uint256 seed) public {
        RevenueTraderP1(address(main.rsrTrader())).setMaxTradeSlippage(
            uint192(between(seed, 0, 1e18))
        );
        // 1e18 is Trading.MAX_TRADE_SLIPPAGE
    }

    function setRTokenTraderMaxTradeSlippage(uint256 seed) public {
        RevenueTraderP1(address(main.rTokenTrader())).setMaxTradeSlippage(
            uint192(between(seed, 0, 1e18))
        );
        // 1e18 is Trading.MAX_TRADE_SLIPPAGE
    }

    function setBackingManagerMaxTradeSlippage(uint256 seed) public {
        BackingManagerP1(address(main.backingManager())).setMaxTradeSlippage(
            uint192(between(seed, 0, 1e18))
        );
        // 1e18 is Trading.MAX_TRADE_SLIPPAGE
    }

    function setStakeRewardPeriod(uint256 seed) public {
        StRSRP1(address(main.stRSR())).setRewardPeriod(uint32(between(seed, 1, 31536000)));
    }

    function setStakeRewardRatio(uint256 seed) public {
        StRSRP1(address(main.stRSR())).setRewardRatio(uint192(between(seed, 1, 1e18)));
    }

    function setUnstakingDelay(uint256 seed) public {
        StRSRP1(address(main.stRSR())).setUnstakingDelay(uint32(between(seed, 1, 31536000)));
    }

    // ================ System Properties ================

    // The system is always fully capitalized
    function echidna_isFullyCapitalized() external view returns (bool) {
        return main.basketHandler().fullyCapitalized();
    }

    // The system is always fully capitalized (implemented a little more manually)
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
        BasketHandlerP1Fuzz bh = BasketHandlerP1Fuzz(address(main.basketHandler()));
        bh.savePrev();
        bh.refreshBasket();
        return bh.prevEqualsCurr();
    }

    // RSR and RToken rates never fall
    uint192 public prevRSRRate; // {StRSR/RSR}
    uint192 public prevRTokenRate; // {RTok/BU}

    function rTokenRate() public view returns (uint192) {
        return
            main.rToken().basketsNeeded() == 0
                ? FIX_ONE
                : uint192((FIX_ONE * main.rToken().totalSupply()) / main.rToken().basketsNeeded());
    }

    // pseudo-mutator for saving old rates...
    function saveRates() public {
        prevRSRRate = main.stRSR().exchangeRate();
        prevRTokenRate = rTokenRate();
    }

    function echidna_ratesNeverFall() external view returns (bool) {
        if (main.stRSR().exchangeRate() > prevRSRRate) return false;
        if (rTokenRate() > prevRTokenRate) return false;
        return true;
    }

    // TODO Properties / tests to write (or at least think about writing):
    // The total supply of rtokens increases no faster than max(issuanceRate() * supply, MIN_RATE) per block
}
