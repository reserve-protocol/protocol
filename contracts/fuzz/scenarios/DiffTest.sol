// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

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
import "contracts/fuzz/TradeMock.sol";
import "contracts/fuzz/Utils.sol";

import "contracts/fuzz/FuzzP1.sol";
import "contracts/fuzz/MainP1.sol";
import "contracts/fuzz/FuzzP0.sol";
import "contracts/fuzz/MainP0.sol";

// The diff-test fuzz scenario. Asserts that P0 and P1 have identical behavior
contract DiffTestScenario {
    using FixLib for uint192;

    // Assertion-failure event
    event AssertionFailure(string message);

    PriceModel internal volatile =
        PriceModel({ kind: Kind.Walk, curr: 1e18, low: 0.5e18, high: 2e18 });
    PriceModel internal stable =
        PriceModel({ kind: Kind.Band, curr: 1e18, low: 0.995e18, high: 1.005e18 });
    PriceModel internal growing =
        PriceModel({ kind: Kind.Walk, curr: 1e18, low: 1e18, high: 1.1e18 });
    PriceModel internal justOne = PriceModel({ kind: Kind.Constant, curr: 1e18, low: 0, high: 0 });

    bytes32[] public targetNames = [bytes32("USD"), bytes32("A"), bytes32("B"), bytes32("C")];

    // The Main instances! p[0] is P0, p[1] is P1.
    IMainFuzz[2] public p;

    // Register and track priceModels that can be used in new assets/collateral
    PriceModel[] public priceModels;
    uint256 public priceModelIndex;

    // Once constructed, everything is set up for random echidna runs to happen:
    // - p[0] and p[1] (Each system's Main) and their components are up
    // - standard tokens, and their Assets and Collateral, exist
    // - standard basket is configured
    // - at least one user has plenty of starting tokens
    IERC20[] public collateralTokens;
    IERC20[] public backupTokens;

    constructor() {
        p[0] = new MainP0Fuzz();
        p[1] = new MainP1Fuzz();

        uint192 maxTradeVolume = defaultParams().rTokenMaxTradeVolume;

        // For each main...
        for (uint256 proto = 0; proto < 2; proto++) {
            // start with empty collateralTokens and backupTokens
            while (collateralTokens.length > 0) collateralTokens.pop();
            while (backupTokens.length > 0) backupTokens.pop();

            IMainFuzz main = p[proto];

            main.initFuzz(defaultParams(), new MarketMock(main, SettlingMode.Acceptable));

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
                            maxTradeVolume,
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
                        maxTradeVolume,
                        5e16, // defaultThreshold
                        86400, // delayUntilDefault
                        IERC20Metadata(address(0)),
                        bytes32("USD"),
                        growing,
                        justOne,
                        justOne,
                        stable
                    )
                );
                collateralTokens.push(IERC20(token));
            }

            // Create three "standard" backup USD tokens
            for (uint256 i = 0; i < 3; i++) {
                string memory num = Strings.toString(i);
                ERC20Fuzz token = new ERC20Fuzz(
                    concat("Stable USD ", num),
                    concat("USD", num),
                    main
                );
                main.addToken(token);

                main.assetRegistry().register(
                    new CollateralMock(
                        IERC20Metadata(address(token)),
                        IERC20Metadata(address(0)), // no reward
                        maxTradeVolume,
                        5e16, // defaultThreshold
                        86400, // delayUntilDefault
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
        }
    }

    // In the modified function, send transactions from *this* contract as if they were from
    // msg.sender, which is presumably the echdina-chosen user.
    modifier asSender() {
        p[0].spoof(address(this), msg.sender);
        p[1].spoof(address(this), msg.sender);
        _;
        p[0].unspoof(address(this));
        p[1].unspoof(address(this));
    }

    // ================ mutators ================

    // TODO: add mutators that introduce defaults and basket-breaking governance actions

    // ==== user functions: token ops ====
    function transfer(
        uint8 userID,
        uint8 tokenID,
        uint256 amount
    ) public asSender {
        for (uint256 N = 0; N < 2; N++) {
            IERC20Metadata token = IERC20Metadata(address(p[N].someToken(tokenID)));
            token.transfer(p[N].someAddr(userID), amount);
        }
    }

    function approve(
        uint8 spenderID,
        uint8 tokenID,
        uint256 amount
    ) public asSender {
        for (uint256 N = 0; N < 2; N++) {
            IERC20 token = p[N].someToken(tokenID);
            token.approve(p[N].someAddr(spenderID), amount);
        }
    }

    function transferFrom(
        uint8 fromID,
        uint8 toID,
        uint8 tokenID,
        uint256 amount
    ) public asSender {
        for (uint256 N = 0; N < 2; N++) {
            IERC20 token = p[N].someToken(tokenID);
            token.transferFrom(p[N].someAddr(fromID), p[N].someAddr(toID), amount);
        }
    }

    function mint(
        uint8 userID,
        uint8 tokenID,
        uint256 amount
    ) public {
        for (uint256 N = 0; N < 2; N++) {
            IERC20Metadata token = IERC20Metadata(address(p[N].someToken(tokenID)));
            require(
                address(token) != address(p[N].rToken()) && address(token) != address(p[N].stRSR()),
                "Do not just mint RTokens/StRSR"
            );
            ERC20Fuzz(address(token)).mint(p[N].someUser(userID), amount);
            require(token.totalSupply() <= 1e57, "Do not mint 'unreasonably' many tokens");
        }
    }

    function burn(
        uint8 userID,
        uint8 tokenID,
        uint256 amount
    ) public {
        for (uint256 N = 0; N < 2; N++) {
            IERC20 token = p[N].someToken(tokenID);
            require(
                address(token) != address(p[N].rToken()) && address(token) != address(p[N].stRSR()),
                "Do not just burn RTokens/StRSR"
            );
            ERC20Fuzz(address(token)).burn(p[N].someUser(userID), amount);
        }
    }

    // ==== user functions: asset registry ====
    // consider: is this just the right model here?
    function refreshAssets() public {
        for (uint256 N = 0; N < 2; N++) p[N].assetRegistry().refresh();
    }

    struct RegisterAssetConfig {
        // struct just to avoid stack-too-deep. x_x
        bool createNewToken;
        bool stable;
        bool coll;
        bool setReward;
        uint8 targetNameID;
        uint256 rewardIndex;
    }

    function registerAsset(
        uint8 tokenID,
        uint256 defaultThresholdSeed,
        uint256 delayUntilDefaultSeed,
        uint256 choiceSeed
    ) public {
        RegisterAssetConfig memory conf;
        // choiceSeed always gets /= 10^k, so these values are easier to infer
        // from debugging info.
        conf.createNewToken = choiceSeed % 10 == 0;
        choiceSeed /= 10;
        conf.stable = choiceSeed % 2 == 0;
        choiceSeed /= 10;
        conf.coll = choiceSeed % 2 == 0;
        choiceSeed /= 10;
        conf.setReward = choiceSeed % 2 == 0;
        choiceSeed /= 10;
        conf.targetNameID = uint8(choiceSeed % 10);
        choiceSeed /= 10;
        conf.rewardIndex = choiceSeed % 100;
        choiceSeed /= 100;

        if (conf.createNewToken) {
            tokenID = uint8(createToken(someTargetName(conf.targetNameID), "Coll", "C"));
        }

        uint256 initPMID;

        for (uint256 N = 0; N < 2; N++) {
            IERC20Metadata erc20 = IERC20Metadata(address(p[N].someToken(tokenID)));

            IERC20Metadata rewardERC20 = conf.setReward
                ? IERC20Metadata(address(p[N].tokens(conf.rewardIndex % p[N].numTokens())))
                : IERC20Metadata(address(0));

            if (conf.coll) {
                if (N == 0) initPMID = priceModelIndex;
                else priceModelIndex = initPMID;

                p[N].assetRegistry().register(
                    createColl(
                        erc20,
                        rewardERC20,
                        conf.stable,
                        defaultThresholdSeed,
                        delayUntilDefaultSeed,
                        someTargetName(conf.targetNameID)
                    )
                );
            } else {
                p[N].assetRegistry().register(
                    new AssetMock(
                        erc20,
                        rewardERC20,
                        defaultParams().rTokenMaxTradeVolume,
                        getNextPriceModel()
                    )
                );
            }
        }
    }

    struct SwapRegistryConfig {
        bool stable;
        bool coll;
        uint8 targetNameID;
        bool setReward;
        uint256 rewardIndex;
    }

    function swapRegisteredAsset(
        uint8 tokenID,
        uint256 defaultThresholdSeed,
        uint256 delayUntilDefaultSeed,
        uint256 choiceSeed
    ) public {
        SwapRegistryConfig memory conf;

        conf.stable = choiceSeed % 2 == 0;
        choiceSeed /= 10;
        conf.coll = (choiceSeed % 2 == 0);
        choiceSeed /= 10;
        conf.setReward = choiceSeed % 2 == 0;
        choiceSeed /= 10;
        conf.targetNameID = uint8(choiceSeed % 10);
        choiceSeed /= 10;
        conf.rewardIndex = choiceSeed % 100;
        choiceSeed /= 100;

        uint256 initPMID;

        for (uint256 N = 0; N < 2; N++) {
            IAssetRegistry reg = p[N].assetRegistry();
            IERC20Metadata erc20 = IERC20Metadata(address(p[N].tokens(tokenID)));
            require(
                reg.isRegistered(erc20),
                "no asset registered for selected tokenID"
            );

            bytes32 targetName;
            if (reg.toAsset(erc20).isCollateral()) {
                targetName = reg.toColl(erc20).targetName();
            }
            else targetName = someTargetName(conf.targetNameID);

            IERC20Metadata rewardERC20 = conf.setReward
                ? IERC20Metadata(address(p[N].tokens(conf.rewardIndex % p[N].numTokens())))
                : IERC20Metadata(address(0));

            if (conf.coll) {
                // This is gnarly, but it should work to ensure that both collateral we make
                // here initially configured identically.
                if (N == 0) initPMID = priceModelIndex;
                else priceModelIndex = initPMID;

                reg.swapRegistered(
                    createColl(
                        erc20,
                        rewardERC20,
                        conf.stable,
                        defaultThresholdSeed,
                        delayUntilDefaultSeed,
                        targetName
                    )
                );
            } else {
                reg.swapRegistered(
                    new AssetMock(
                        IERC20Metadata(address(erc20)),
                        IERC20Metadata(address(0)), // no recursive reward
                        defaultParams().rTokenMaxTradeVolume,
                        getNextPriceModel()
                    )
                );
            }
        }
    }

    function unregisterAsset(uint8 tokenID) public {
        for (uint256 N = 0; N < 2; N++) {
            IMainFuzz main = p[N];
            IERC20 erc20 = main.someToken(tokenID);
            IAssetRegistry reg = main.assetRegistry();
            if (!reg.isRegistered(erc20)) return;

            IAsset asset = reg.toAsset(erc20);
            reg.unregister(asset);
        }
    }

    // ==== user functions: rtoken ====

    // do issuance without doing allowances first
    function justIssue(uint256 amount) public asSender {
        for (uint256 N = 0; N < 2; N++) {
            p[N].rToken().issue(amount);
        }
    }

    // do allowances as needed, and *then* do issuance
    function issue(uint256 amount) public asSender {
        for (uint256 N = 0; N < 2; N++) {
            require(
                amount + p[N].rToken().totalSupply() <= 1e48,
                "Do not issue 'unreasonably' many rTokens"
            );

            address[] memory tokens;
            uint256[] memory tokenAmounts;
            (tokens, tokenAmounts) = (RTokenP1Fuzz(address(p[N].rToken()))).quote(amount, CEIL);
            for (uint256 i = 0; i < tokens.length; i++) {
                IERC20(tokens[i]).approve(address(p[N].rToken()), tokenAmounts[i]);
            }
            p[N].rToken().issue(amount);
        }
    }

    function cancelIssuance(uint256 seedID, bool earliest) public asSender {
        for (uint256 N = 0; N < 2; N++) {
            // filter endIDs mostly to valid IDs
            address user = msg.sender;
            RTokenP1Fuzz rtoken = RTokenP1Fuzz(address(p[N].rToken()));
            (uint256 left, uint256 right) = rtoken.idRange(user);
            uint256 id = between(left == 0 ? 0 : left - 1, right + 1, seedID);

            // Do cancel
            rtoken.cancel(id, earliest);
        }
    }

    function vestIssuance(uint256 seedID) public asSender {
        for (uint256 N = 0; N < 2; N++) {
            // filter endIDs mostly to valid IDs
            address user = msg.sender;
            RTokenP1Fuzz rtoken = RTokenP1Fuzz(address(p[N].rToken()));

            (uint256 left, uint256 right) = rtoken.idRange(user);
            uint256 id = between(left == 0 ? 0 : left - 1, right + 1, seedID);

            // Do vest
            rtoken.vest(user, id);
        }
    }

    function redeem(uint256 amount) public asSender {
        for (uint256 N = 0; N < 2; N++) {
            p[N].rToken().redeem(amount);
        }
    }

    // ==== user functions: strsr ====
    function justStake(uint256 amount) public asSender {
        for (uint256 N = 0; N < 2; N++) {
            p[N].stRSR().stake(amount);
        }
    }

    function stake(uint256 amount) public asSender {
        for (uint256 N = 0; N < 2; N++) {
            p[N].rsr().approve(address(p[N].stRSR()), amount);
            p[N].stRSR().stake(amount);
        }
    }

    function unstake(uint256 amount) public asSender {
        for (uint256 N = 0; N < 2; N++) {
            p[N].stRSR().unstake(amount);
        }
    }

    function withdraw(uint256 seedAddr, uint256 seedID) public asSender {
        for (uint256 N = 0; N < 2; N++) {
            address user = p[N].someAddr(seedAddr);
            (uint256 left, uint256 right) = StRSRP1Fuzz(address(p[N].stRSR())).idRange(user);
            uint256 id = between(left == 0 ? 0 : left - 1, right + 1, seedID);
            p[N].stRSR().withdraw(user, id);
        }
    }

    function withdrawAvailable() public asSender {
        for (uint256 N = 0; N < 2; N++) {
            address user = msg.sender;
            uint256 id = p[N].stRSR().endIdForWithdraw(user);
            p[N].stRSR().withdraw(user, id);
        }
    }

    // ==== keeper functions ====
    function updatePrice(
        uint256 seedID,
        uint192 a,
        uint192 b,
        uint192 c,
        uint192 d
    ) public {
        for (uint256 N = 0; N < 2; N++) {
            IERC20 erc20 = p[N].someToken(seedID);
            if (address(erc20) == address(p[N].rToken())) return; // can't set RToken price.

            IAssetRegistry reg = p[N].assetRegistry();
            if (!reg.isRegistered(erc20)) return;
            IAsset asset = reg.toAsset(erc20);
            if (asset.isCollateral()) {
                CollateralMock(address(asset)).update(a, b, c, d);
            } else {
                AssetMock(address(asset)).update(a);
            }
        }
    }

    // update reward amount
    function updateRewards(uint256 seedID, uint256 a) public {
        for (uint256 N = 0; N < 2; N++) {
            IERC20 erc20 = p[N].someToken(seedID);
            IAssetRegistry reg = p[N].assetRegistry();
            if (!reg.isRegistered(erc20)) return;
            AssetMock asset = AssetMock(address(reg.toAsset(erc20)));
            asset.updateRewardAmount(a);
            // same signature on CollateralMock. Could define a whole interface, but eh
        }
    }

    function claimProtocolRewards(uint8 which) public {
        for (uint256 N = 0; N < 2; N++) {
            which %= 4;
            if (which == 0) p[N].rTokenTrader().claimAndSweepRewards();
            else if (which == 1) p[N].rsrTrader().claimAndSweepRewards();
            else if (which == 2) p[N].backingManager().claimAndSweepRewards();
            else if (which == 3) p[N].rToken().claimAndSweepRewards();
        }
    }

    function pushSeedForTrades(uint256 seed) public {
        for (uint256 N = 0; N < 2; N++) {
            IMarketMock(address(p[N].marketMock())).pushSeed(seed);
        }
    }

    function popSeedForTrades() public {
        for (uint256 N = 0; N < 2; N++) {
            IMarketMock(address(p[N].marketMock())).popSeed();
        }
    }

    function settleTrades() public {
        BrokerP0Fuzz(address(p[0].broker())).settleTrades();
        BrokerP1Fuzz(address(p[1].broker())).settleTrades();
    }

    IERC20[] internal backingToManage;

    function pushBackingToManage(uint256 tokenID) public {
        for (uint256 N = 0; N < 2; N++) {
            backingToManage.push(p[N].someToken(tokenID));
        }
    }

    function popBackingToManage() public {
        for (uint256 N = 0; N < 2; N++) {
            if (backingToManage.length > 0) backingToManage.pop();
        }
    }

    function manageBackingTokens() public {
        for (uint256 N = 0; N < 2; N++) {
            p[N].backingManager().manageTokens(backingToManage);
        }
    }

    function manageTokenInRSRTrader(uint256 tokenID) public {
        for (uint256 N = 0; N < 2; N++) {
            p[N].rsrTrader().manageToken(p[N].someToken(tokenID));
        }
    }

    function manageTokenInRTokenTrader(uint256 tokenID) public {
        for (uint256 N = 0; N < 2; N++) {
            p[N].rTokenTrader().manageToken(p[N].someToken(tokenID));
        }
    }

    function grantAllowances(uint256 tokenID) public {
        for (uint256 N = 0; N < 2; N++) {
            p[N].backingManager().grantRTokenAllowance(p[N].someToken(tokenID));
        }
    }

    function justDistributeRevenue(
        uint256 tokenID,
        uint8 fromID,
        uint256 amount
    ) public asSender {
        for (uint256 N = 0; N < 2; N++) {
            IMainFuzz main = p[N];
            IERC20 token = main.someToken(tokenID);
            address dest = main.someAddr(fromID);
            main.distributor().distribute(token, dest, amount);
        }
    }

    // do revenue distribution granting allowance first - only RSR or RToken
    // TODO
    /* function distributeRevenue( */
    /*     uint8 which, */
    /*     uint8 fromID, */
    /*     uint256 amount */
    /* ) public; */

    function payRSRProfits() public {
        for (uint256 N = 0; N < 2; N++) {
            p[N].stRSR().payoutRewards();
        }
    }

    function payRTokenProfits() public {
        for (uint256 N = 0; N < 2; N++) {
            p[N].furnace().melt();
        }
    }

    // Basket handler TODO
    // function refreshBasket() public;

    // ==== Configure Basket ====
    uint256[] public backingForPrimeBasket;
    uint192[] public targetAmtsForPrimeBasket;

    function pushBackingForPrimeBasket(uint256 tokenID, uint256 seed) public {
        backingForPrimeBasket.push(tokenID);
        targetAmtsForPrimeBasket.push(uint192(between(1, 1000e18, seed)));
        // 1000e18 is BH.MAX_TARGET_AMT
    }

    function popBackingForPrimeBasket() public {
        if (backingForPrimeBasket.length > 0) {
            backingForPrimeBasket.pop();
            targetAmtsForPrimeBasket.pop();
        }
    }

    // function setPrimeBasket() public; TODO
    uint256[] public backingForBackup;

    function pushBackingForBackup(uint256 tokenID) public {
        backingForBackup.push(tokenID);
    }

    function popBackingForBackup(uint8 targetNameID) public {
        if (backingForBackup.length > 0)
            backingForBackup.pop();
    }

    // function setBackupConfig() public; TODO
    // just use backup tokens that have the same targetName as the
    // first element in backingForBackup

    function poke() public {
        for (uint256 N = 0; N < 2; N++) p[N].poke();
    }

    // ==== Freezing / pausing functions ====
    function freezeShort() public asSender {
        for (uint256 N = 0; N < 2; N++) p[N].freezeShort();
    }

    function freezeLong() public asSender {
        for (uint256 N = 0; N < 2; N++) p[N].freezeLong();
    }

    function freezeForever() public asSender {
        for (uint256 N = 0; N < 2; N++) p[N].freezeForever();
    }

    function unfreeze() public asSender {
        for (uint256 N = 0; N < 2; N++) p[N].unfreeze();
    }

    function pause() public asSender {
        for (uint256 N = 0; N < 2; N++) p[N].pause();
    }

    function unpause() public asSender {
        for (uint256 N = 0; N < 2; N++) p[N].unpause();
    }

    // ==== governance changes ====
    function setDistribution(
        uint256 seedID,
        uint16 rTokenDist,
        uint16 rsrDist
    ) public {
        for (uint256 N = 0; N < 2; N++) {
            RevenueShare memory dist = RevenueShare(rTokenDist, rsrDist);
            p[N].distributor().setDistribution(p[N].someAddr(seedID), dist);
        }
    }

    function setBackingBuffer(uint256 seed) public {
        for (uint256 N = 0; N < 2; N++) {
            TestIBackingManager(address(p[N].backingManager())).setBackingBuffer(
                uint192(between(0, 1e18, seed))
            ); // 1e18 == MAX_BACKING_BUFFER
        }
    }

    function setBackingManagerTradingDelay(uint256 seed) public {
        for (uint256 N = 0; N < 2; N++) {
            TestIBackingManager(address(p[N].backingManager())).setTradingDelay(
                uint48(between(0, 31536000, seed))
            ); // 31536000 is BackingManager.MAX_TRADING_DELAY
        }
    }

    function setAuctionLength(uint256 seed) public {
        for (uint256 N = 0; N < 2; N++) {
            TestIBroker(address(p[N].broker())).setAuctionLength(uint48(between(1, 604800, seed)));
            // 604800 is Broker.MAX_AUCTION_LENGTH
        }
    }

    function setFurnacePeriod(uint256 seed) public {
        for (uint256 N = 0; N < 2; N++) {
            p[N].furnace().setPeriod(uint48(between(1, 31536000, seed)));
            // 31536000 is Furnace.MAX_PERIOD
        }
    }

    function setFurnaceRatio(uint256 seed) public {
        for (uint256 N = 0; N < 2; N++) {
            p[N].furnace().setRatio(uint192(between(0, 1e18, seed)));
            // 1e18 is Furnace.MAX_RATIO
        }
    }

    function setIssuanceRate(uint256 seed) public {
        for (uint256 N = 0; N < 2; N++) {
            TestIRToken(address(p[N].rToken())).setIssuanceRate(uint192(between(0, 1e18, seed)));
            // 1e18 is RToken.MAX_ISSUANCE_RATE
        }
    }

    function setScalingRedemptionRate(uint256 seed) public {
        for (uint256 N = 0; N < 2; N++) {
            TestIRToken token = TestIRToken(address(p[N].rToken()));
            token.setScalingRedemptionRate(uint192(between(0, 1e18, seed)));
            // 1e18 is RToken.MAX_REDEMPTION
        }
    }

    function setRedemptionRateFloor(uint256 seed) public {
        for (uint256 N = 0; N < 2; N++) {
            TestIRToken token = TestIRToken(address(p[N].rToken()));
            token.setRedemptionRateFloor(uint192(between(0, 1e18, seed)));
            // 1e18 is RToken.MAX_REDEMPTION
        }
    }

    function setRSRTraderMaxTradeSlippage(uint256 seed) public {
        for (uint256 N = 0; N < 2; N++) {
            TestITrading(address(p[N].rsrTrader())).setMaxTradeSlippage(
                uint192(between(0, 1e18, seed))
            );
            // 1e18 is Trading.MAX_TRADE_SLIPPAGE
        }
    }

    function setRTokenTraderMaxTradeSlippage(uint256 seed) public {
        for (uint256 N = 0; N < 2; N++) {
            TestITrading(address(p[N].rTokenTrader())).setMaxTradeSlippage(
                uint192(between(0, 1e18, seed))
            );
            // 1e18 is Trading.MAX_TRADE_SLIPPAGE
        }
    }

    function setBackingManagerMaxTradeSlippage(uint256 seed) public {
        for (uint256 N = 0; N < 2; N++) {
            TestITrading(address(p[N].backingManager())).setMaxTradeSlippage(
                uint192(between(0, 1e18, seed))
            );
            // 1e18 is Trading.MAX_TRADE_SLIPPAGE
        }
    }

    function setStakeRewardPeriod(uint256 seed) public {
        for (uint256 N = 0; N < 2; N++) {
            TestIStRSR(address(p[N].stRSR())).setRewardPeriod(uint48(between(1, 31536000, seed)));
        }
    }

    function setStakeRewardRatio(uint256 seed) public {
        for (uint256 N = 0; N < 2; N++) {
            TestIStRSR(address(p[N].stRSR())).setRewardRatio(uint192(between(1, 1e18, seed)));
        }
    }

    function setUnstakingDelay(uint256 seed) public {
        for (uint256 N = 0; N < 2; N++) {
            TestIStRSR(address(p[N].stRSR())).setUnstakingDelay(uint48(between(1, 31536000, seed)));
        }
    }

    function setBrokerDisabled(bool disabled) public {
        for (uint256 N = 0; N < 2; N++) {
            TestIBroker(address(p[N].broker())).setDisabled(disabled);
        }
    }

    function setShortFreeze(uint48 freeze) public {
        for (uint256 N = 0; N < 2; N++) {
            TestIMain(address(p[N])).setShortFreeze(freeze);
        }
    }

    function setLongFreeze(uint48 freeze) public {
        for (uint256 N = 0; N < 2; N++) {
            TestIMain(address(p[N])).setLongFreeze(freeze);
        }
    }

    // Grant/Revoke Roles
    function grantRole(uint8 which, uint8 userID) public {
        for (uint256 N = 0; N < 2; N++) {
            IMainFuzz main = p[N];
            address user = main.someAddr(userID);
            which %= 4;
            if (which == 0) main.grantRole(OWNER, user);
            else if (which == 1) main.grantRole(SHORT_FREEZER, user);
            else if (which == 2) main.grantRole(LONG_FREEZER, user);
            else if (which == 3) main.grantRole(PAUSER, user);
        }
    }

    function revokeRole(uint8 which, uint8 userID) public {
        for (uint256 N = 0; N < 2; N++) {
            IMainFuzz main = p[N];
            address user = main.someAddr(userID);
            which %= 4;
            if (which == 0) main.revokeRole(OWNER, user);
            else if (which == 1) main.revokeRole(SHORT_FREEZER, user);
            else if (which == 2) main.revokeRole(LONG_FREEZER, user);
            else if (which == 3) main.revokeRole(PAUSER, user);
        }
    }

    // ==== Helpers ====

    function someTargetName(uint256 seed) public view returns (bytes32) {
        uint256 id = seed % targetNames.length;
        return targetNames[id];
    }

    function pushPriceModel(
        uint256 which,
        uint256 currSeed,
        uint256 lowSeed,
        uint256 highSeed
    ) public {
        // Set Kind
        Kind _kind = Kind(which % (uint8(type(Kind).max) + 1));

        PriceModel memory _priceModel = PriceModel({
            kind: _kind,
            curr: uint192(currSeed),
            low: uint192(between(0, currSeed, lowSeed)),
            high: uint192(between(currSeed, type(uint192).max, highSeed))
        });
        priceModels.push(_priceModel);
    }

    function popPriceModel() public {
        if(priceModels.length > 0) priceModels.pop();
    }

    function getNextPriceModel() public returns (PriceModel memory) {
        if (priceModels.length == 0) return stable;
        uint256 currID = priceModelIndex % priceModels.length;
        priceModelIndex = (priceModelIndex + 1) % priceModels.length; // next ID
        return priceModels[currID];
    }

    // Construct a new ERC20Fuzz token in each Main
    // @return The (shared) token ID of the newly added tokens
    function createToken(
        bytes32 targetName,
        string memory namePrefix,
        string memory symbolPrefix
    ) public returns (uint256) {
        string memory targetStr = bytes32ToString(targetName);

        uint256 tokenID = p[0].numTokens();
        assert(p[0].numTokens() == p[1].numTokens());
        string memory idStr = Strings.toString(tokenID);

        for (uint256 N = 0; N < 2; N++) {
            ERC20Fuzz token = new ERC20Fuzz(
                concat(namePrefix, targetStr, " ", idStr),
                concat(symbolPrefix, targetStr, idStr),
                p[N]
            );
            p[N].addToken(token);
        }
        return tokenID;
    }

    // Construct a new token, and wrap it in a new Reward asset
    // @return The (shared) token ID of the newly added tokens
    function createRewardAsset(bytes32 targetName) public returns (uint256) {
        uint256 tokenID = createToken(targetName, "Reward", "R");

        for (uint256 N = 0; N < 2; N++) {
            IERC20Metadata tok = IERC20Metadata(address(p[N].tokens(tokenID)));
            p[N].assetRegistry().register(
                new AssetMock(
                    tok,
                    IERC20Metadata(address(0)),
                    defaultParams().rTokenMaxTradeVolume,
                    getNextPriceModel()
                )
            );
        }

        return tokenID;
    }

    /// save the last-created collateral mock from createColl
    /// this is _just_ for ease of testing these tests.
    CollateralMock public lastCreatedColl;

    /// Create and return one new CollateralMock contract.
    /// @return The created Collateral address

    function createColl(
        IERC20 erc20,
        IERC20 rewardERC20,
        bool isStable,
        uint256 defaultThresholdSeed,
        uint256 delayUntilDefaultSeed,
        bytes32 targetName
    ) public returns (CollateralMock) {
        lastCreatedColl =
            new CollateralMock(
                IERC20Metadata(address(erc20)),
                IERC20Metadata(address(rewardERC20)),
                defaultParams().rTokenMaxTradeVolume,
                uint192(between(1, 1e18, defaultThresholdSeed)), // def threshold
                between(1, type(uint256).max, delayUntilDefaultSeed), // delay until default
                IERC20Metadata(address(0)),
                targetName,
                isStable ? growing : getNextPriceModel(),
                isStable ? justOne : getNextPriceModel(),
                isStable ? justOne : getNextPriceModel(),
                isStable ? stable : getNextPriceModel()
            );
        return lastCreatedColl;
    }

    // ================ Equivalence Properties ================
    function echidna_allTokensEqual() public view returns (bool) {
        if (p[0].numUsers() != p[1].numUsers()) return false;
        if (p[0].numTokens() != p[1].numTokens()) return false;

        for (uint256 t = 0; t < p[0].numTokens() + 3; t++) {
            // total supplies are equal
            if (p[0].someToken(t).totalSupply() != p[1].someToken(t).totalSupply()) return false;

            // balances are equal
            for (uint256 u = 0; u < p[0].numUsers(); u++) {
                uint256 bal0 = p[0].someToken(t).balanceOf(p[0].users(u));
                uint256 bal1 = p[1].someToken(t).balanceOf(p[1].users(u));
                if (bal0 != bal1) return false;
            }
        }
        return true;
    }
}
