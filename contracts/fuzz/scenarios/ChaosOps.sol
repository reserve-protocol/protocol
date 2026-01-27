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
import "contracts/fuzz/ERC20ReentrantFuzz.sol";
import "contracts/fuzz/PriceModel.sol";
import "contracts/fuzz/Trades.sol";
import "contracts/fuzz/Utils.sol";
import "contracts/fuzz/FuzzP1.sol";

import "contracts/fuzz/MainP1.sol";

// solhint-disable max-states-count

// The "chaos operations" fuzzing scenario, in which:
// - Tokens may default
// - The basket may change after initialization
// - Significant governance changes occur
// - Reentrancy attacks are attempted
contract ChaosOpsScenario is IReentrantScenario {
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
    PriceModel internal mayHardDefault =
        PriceModel({ kind: Kind.Walk, curr: 1e18, low: 0.99e18, high: 1.1e18 });
    PriceModel internal mayDepeg =
        PriceModel({ kind: Kind.Walk, curr: 1e18, low: 0.85e18, high: 1.25e18 });
    PriceModel internal justOne = PriceModel({ kind: Kind.Constant, curr: 1e18, low: 0, high: 0 });

    IERC20[] public collateralTokens;
    mapping(bytes32 => IERC20[]) public backupTokens;

    bytes32[] public targetNames = [bytes32("A"), bytes32("B"), bytes32("C")];
    mapping(bytes32 => uint256) public targetWeightsByName;
    mapping(address => bytes32) public targetNameByToken;

    // Used to create unique asset/col symbols - Starts with 3 to avoid collisions
    uint256 internal tokenIdNonce = 3;

    // Register and track priceModels that can be used in new assets/collateral
    PriceModel[] public priceModels;
    uint256 internal priceModelIndex;

    // ========== Reentrancy Testing State ==========
    // Reentrancy target function
    uint8 public reentrancyTarget;

    // Reentrant tokens
    ERC20ReentrantFuzz[] public reentrantTokens;

    // Once constructed, everything is set up for random echidna runs to happen:
    // - main and its components are up
    // - standard tokens, and their Assets and Collateral, exist
    // - standard basket is configured
    // - at least one user has plenty of starting tokens
    constructor() {
        main = new MainP1Fuzz();

        main.initFuzz(defaultParams(), new MarketMock(main, SettlingMode.Random));

        uint192 maxTradeVolume = defaultParams().rTokenMaxTradeVolume;

        targetWeightsByName[bytes32("A")] = 0.4e18;
        targetWeightsByName[bytes32("B")] = 0.3e18;
        targetWeightsByName[bytes32("C")] = 0.3e18;

        // Process each target name - Create collaterals and reward assets
        for (uint256 i = 0; i < 3; i++) {
            bytes32 targetName = targetNames[i];
            string memory targetNameStr = bytes32ToString(targetName);

            // Three initial collateral tokens per target name:
            // Coll #0 - CToken-like, stable, with reward
            // Coll #1 - CToken-like, volatile, may depeg With reward
            // Coll #2 - CToken-like, volatile, may hard default, no reward
            for (uint256 k = 0; k < 3; k++) {
                string memory num = Strings.toString(k);

                ERC20ReentrantFuzz token = new ERC20ReentrantFuzz(
                    concat(concat(concat("Collateral", targetNameStr), " "), num),
                    concat(concat("C", targetNameStr), num),
                    main,
                    this
                );
                targetNameByToken[address(token)] = targetName;
                main.addToken(token);
                reentrantTokens.push(token);

                if (k < 2) {
                    ERC20ReentrantFuzz reward = new ERC20ReentrantFuzz(
                        concat(concat(concat("Reward", targetNameStr), " "), num),
                        concat(concat("R", targetNameStr), num),
                        main,
                        this
                    );
                    main.addToken(reward);
                    token.setRewardToken(reward);
                    main.assetRegistry().register(createAsset(reward));
                    targetNameByToken[address(reward)] = targetName;
                    reentrantTokens.push(reward);
                }

                // Register Collateral
                main.assetRegistry().register(
                    new CollateralMock({
                        erc20_: IERC20Metadata(address(token)),
                        maxTradeVolume_: maxTradeVolume,
                        priceTimeout_: 806400,
                        oracleError_: 0.005e18,
                        defaultThreshold_: 0.05e18,
                        delayUntilDefault_: 86400,
                        targetName_: targetName,
                        refPerTokModel_: [growing, growing, mayHardDefault][k],
                        targetPerRefModel_: [justOne, mayDepeg, justOne][k],
                        uoaPerTargetModel_: [justOne, justOne, justOne][k],
                        deviationModel_: [stable, volatile, volatile][k],
                        revenueHiding: uint192(k * 1e12) // 1/1,000,000 % hiding
                    })
                );
                collateralTokens.push(IERC20(token));
            }

            // Create three stable backup tokens for each target name
            for (uint256 j = 0; j < 3; j++) {
                string memory num = Strings.toString(j);
                ERC20ReentrantFuzz token = new ERC20ReentrantFuzz(
                    concat(concat("Stable", targetNameStr), num),
                    concat(concat("S", targetNameStr), num),
                    main,
                    this
                );
                main.addToken(token);
                reentrantTokens.push(token);
                main.assetRegistry().register(
                    new CollateralMock({
                        erc20_: IERC20Metadata(address(token)),
                        maxTradeVolume_: maxTradeVolume,
                        priceTimeout_: 806400,
                        oracleError_: 0.005e18,
                        defaultThreshold_: 0.05e18,
                        delayUntilDefault_: 86400,
                        targetName_: targetName,
                        refPerTokModel_: justOne,
                        targetPerRefModel_: stable,
                        uoaPerTargetModel_: justOne,
                        deviationModel_: justOne,
                        revenueHiding: 0
                    })
                );
                targetNameByToken[address(token)] = targetName;
                backupTokens[targetName].push(IERC20(token));
            }
        }
        // Configure basket
        uint192[] memory wts = new uint192[](9);
        wts[0] = 0.2e18;
        wts[1] = 0.1e18;
        wts[2] = 0.1e18;
        wts[3] = 0.1e18;
        wts[4] = 0.1e18;
        wts[5] = 0.1e18;
        wts[6] = 0.1e18;
        wts[7] = 0.1e18;
        wts[8] = 0.1e18;

        main.basketHandler().setPrimeBasket(collateralTokens, wts);

        // Set backup config
        for (uint256 i = 0; i < 3; i++) {
            bytes32 targetName = targetNames[i];
            main.basketHandler().setBackupConfig(targetName, 3, backupTokens[targetName]);
        }

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

        // Use reweightable basket for Chaos scenario
        BasketHandlerP1Fuzz(address(main.basketHandler())).setReweightable(true);

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

    // ==== user functions: asset registry ====

    // refresh the state of all assets
    function refreshAssets() public {
        main.assetRegistry().refresh();
    }

    function registerAsset(
        uint8 tokenID,
        uint8 targetNameID,
        uint256 defaultThresholdSeed,
        uint48 delayUntilDefaultSeed,
        bool isColl,
        bool isStable,
        uint256 revenueHidingSeed
    ) public {
        bytes32 targetName = someTargetName(targetNameID);
        IAssetRegistry reg = main.assetRegistry();
        IERC20 erc20 = main.someToken(tokenID);
        require(!reg.isRegistered(erc20), "token already registered");

        if (isColl) {
            reg.register(
                createColl(
                    erc20,
                    isStable,
                    defaultThresholdSeed,
                    delayUntilDefaultSeed,
                    targetName,
                    revenueHidingSeed
                )
            );
        } else {
            reg.register(createAsset(erc20));
        }
    }

    function swapRegisteredAsset(
        uint8 tokenID,
        uint256 defaultThresholdSeed,
        uint48 delayUntilDefaultSeed,
        uint256 switchTypeSeed,
        uint256 stableOrRandomSeed,
        uint256 revenueHidingSeed
    ) public {
        IERC20 erc20 = main.someToken(tokenID);
        IAssetRegistry reg = main.assetRegistry();
        if (!reg.isRegistered(erc20)) return;

        IAsset asset = reg.toAsset(erc20);

        // Switch type Asset -> Coll and viceversa one out of 100 times
        bool switchType = (switchTypeSeed % 100) < 1;
        bool createAsColl = (asset.isCollateral() && !switchType) ||
            (!asset.isCollateral() && switchType);
        bool createStable = (stableOrRandomSeed % 3) == 0;

        if (createAsColl) {
            CollateralMock newColl = createColl(
                erc20,
                createStable,
                defaultThresholdSeed,
                delayUntilDefaultSeed,
                CollateralMock(address(asset)).targetName(),
                revenueHidingSeed
            );
            reg.swapRegistered(newColl);
        } else {
            reg.swapRegistered(createAsset(erc20));
        }
    }

    function unregisterAsset(uint8 tokenID) public {
        IERC20 erc20 = main.someToken(tokenID);
        IAssetRegistry reg = main.assetRegistry();
        if (!reg.isRegistered(erc20)) return;

        IAsset asset = reg.toAsset(erc20);
        reg.unregister(asset);
    }

    function pushPriceModel(
        uint256 which,
        uint256 currSeed,
        uint256 lowSeed,
        uint256 highSeed
    ) public {
        // Set Kind
        Kind _kind;
        which %= 4;
        if (which == 0) _kind = Kind.Constant;
        else if (which == 1) _kind = Kind.Manual;
        else if (which == 2) _kind = Kind.Band;
        else if (which == 3) _kind = Kind.Walk;

        PriceModel memory _priceModel = PriceModel({
            kind: _kind,
            curr: uint192(currSeed),
            low: uint192(between(0, currSeed, lowSeed)),
            high: uint192(between(currSeed, type(uint192).max, highSeed))
        });
        priceModels.push(_priceModel);
    }

    // do issuance without doing allowances first
    function justIssue(uint256 amount) public asSender {
        _saveRTokenRate();
        main.rToken().issue(amount);
        // workaround: disable rate fall check if this is a mint starting at 0 supply
        if (main.rToken().totalSupply() == amount) {
            _saveRTokenRate();
        }
    }

    // do issuance without doing allowances first, to a different recipient
    function justIssueTo(uint256 amount, uint8 recipientID) public asSender {
        _saveRTokenRate();
        address recipient = main.someAddr(recipientID);

        main.rToken().issueTo(recipient, amount);
        // workaround: disable rate fall check if this is a mint starting at 0 supply
        if (main.rToken().totalSupply() == amount) {
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
        if (main.rToken().totalSupply() == amount) {
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
        if (main.rToken().totalSupply() == amount) {
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

    function seizeRSR(uint256 amount) public {
        // As Backing Manager
        main.spoof(address(this), address(main.backingManager()));
        StRSRP1(address(main.stRSR())).seizeRSR(amount);
        main.unspoof(address(this));
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

    function setRewardToken(uint256 tokenID, uint256 rewardTokenID) public {
        ERC20Fuzz erc20 = ERC20Fuzz(address(main.someToken(tokenID)));
        erc20.setRewardToken(ERC20Fuzz(address(main.someToken(rewardTokenID))));
    }

    // update reward amount
    function updateRewards(uint256 seedID, uint256 a) public {
        IERC20 erc20 = main.someToken(seedID);
        IAssetRegistry reg = main.assetRegistry();
        if (!reg.isRegistered(erc20)) return;

        ERC20Fuzz(address(erc20)).setRewardAmount(a);
    }

    // update oracle error states
    function setErrorState(
        uint256 seedID,
        bool stale,
        bool value
    ) public {
        IERC20 erc20 = main.someToken(seedID);
        if (address(erc20) == address(main.rToken())) return; // can't set RToken staleness
        IAssetRegistry reg = main.assetRegistry();
        if (!reg.isRegistered(erc20)) return;
        OracleErrorMock asset = OracleErrorMock(address(reg.toAsset(erc20)));
        stale ? asset.setStalePrice(value) : asset.setPriceOutsideRange(value);
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

    function forceSettleTrade(uint256 tokenID) public {
        IERC20 erc20 = main.someToken(tokenID);
        ITrade trade = main.backingManager().trades(erc20);
        if (address(trade) != address(0)) {
            main.backingManager().forceSettleTrade(trade);
        }
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
        // distribute now uses msg.sender (2/1/23), so spoof from caller
        address fromUser = main.someAddr(fromID);
        main.spoof(address(this), fromUser);
        token.approve(address(main.distributor()), amount);
        main.distributor().distribute(token, amount);
        main.unspoof(address(this));
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

    // Basket handler
    function refreshBasket() public {
        BasketHandlerP1Fuzz bh = BasketHandlerP1Fuzz(address(main.basketHandler()));
        bh.refreshBasket();
    }

    // Prime basket
    IERC20[] internal backingForPrimeBasket;
    uint192[] internal targetAmtsForPrimeBasket;

    function pushBackingForPrimeBasket(uint256 tokenID, uint256 seed) public {
        backingForPrimeBasket.push(main.someToken(tokenID));
        targetAmtsForPrimeBasket.push(uint192(between(1, 1000e18, seed)));
        // 1000e18 is BH.MAX_TARGET_AMT
    }

    function popBackingForPrimeBasket() public {
        if (backingForPrimeBasket.length > 0) {
            backingForPrimeBasket.pop();
            targetAmtsForPrimeBasket.pop();
        }
    }

    // function _validateWeights() internal view {
    //     uint256 totalWeight = 0;
    //     uint256 weightA = 0;
    //     uint256 weightB = 0;
    //     uint256 weightC = 0;

    //     for (uint256 i = 0; i < targetAmtsForPrimeBasket.length; i++) {
    //         bytes32 nameGroup = targetNameByToken[address(backingForPrimeBasket[i])];
    //         if (nameGroup == bytes32("A")) {
    //             weightA += targetAmtsForPrimeBasket[i];
    //         } else if (nameGroup == bytes32("B")) {
    //             weightB += targetAmtsForPrimeBasket[i];
    //         } else if (nameGroup == bytes32("C")) {
    //             weightC += targetAmtsForPrimeBasket[i];
    //         }
    //         totalWeight += targetAmtsForPrimeBasket[i];
    //     }
    //     require(
    //         (weightA * 1e18) / totalWeight == targetWeightsByName[bytes32("A")] &&
    //             (weightB * 1e18) / totalWeight == targetWeightsByName[bytes32("B")] &&
    //             (weightC * 1e18) / totalWeight == targetWeightsByName[bytes32("C")],
    //         "can't rebalance bad weights"
    //     );
    // }

    function setPrimeBasket() public {
        BasketHandlerP1Fuzz bh = BasketHandlerP1Fuzz(address(main.basketHandler()));
        // if(!bh.reweightable()) _validateWeights();
        bh.setPrimeBasket(backingForPrimeBasket, targetAmtsForPrimeBasket);
    }

    function forceSetPrimeBasket() public {
        BasketHandlerP1Fuzz bh = BasketHandlerP1Fuzz(address(main.basketHandler()));
        // if(!bh.reweightable()) _validateWeights();
        bh.forceSetPrimeBasket(backingForPrimeBasket, targetAmtsForPrimeBasket);
    }

    // Backup basket
    mapping(bytes32 => IERC20[]) internal backingForBackup;

    function pushBackingForBackup(uint256 tokenID) public {
        IERC20 token = main.someToken(tokenID);
        IAssetRegistry reg = main.assetRegistry();
        if (!reg.isRegistered(token)) return;

        IAsset asset = reg.toAsset(token);
        if (asset.isCollateral()) {
            bytes32 targetName = CollateralMock(address(asset)).targetName();
            backingForBackup[targetName].push(token);
        }
    }

    function popBackingForBackup(uint8 targetNameID) public {
        bytes32 targetName = someTargetName(targetNameID);
        if (backingForBackup[targetName].length > 0) backingForBackup[targetName].pop();
    }

    function setBackupConfig(uint8 targetNameID) public {
        BasketHandlerP1Fuzz bh = BasketHandlerP1Fuzz(address(main.basketHandler()));
        bytes32 targetName = someTargetName(targetNameID);
        bh.setBackupConfig(
            targetName,
            backingForBackup[targetName].length,
            backingForBackup[targetName]
        );
    }

    // ==== user functions: main ====

    function poke() public {
        main.poke();
    }

    // Freezing/Pausing
    function freezeShort() public asSender {
        main.freezeShort();
    }

    function freezeLong() public asSender {
        main.freezeLong();
    }

    function freezeForever() public asSender {
        main.freezeForever();
    }

    function unfreeze() public asSender {
        main.unfreeze();
    }

    function pauseIssuance() public asSender {
        main.pauseIssuance();
    }

    function pauseTrading() public asSender {
        main.pauseTrading();
    }

    function unpauseIssuance() public asSender {
        main.unpauseIssuance();
    }

    function unpauseTrading() public asSender {
        main.unpauseTrading();
    }

    function setIssuanceThrottleParamsDirect(ThrottleLib.Params calldata params) public {
        TestIRToken(address(main.rToken())).setIssuanceThrottleParams(params);
    }

    function setRedemptionThrottleParamsDirect(ThrottleLib.Params calldata params) public {
        TestIRToken(address(main.rToken())).setRedemptionThrottleParams(params);
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
        StRSRP1(address(main.stRSR())).setRewardRatio(uint192(between(1, 1e14, seed)));
    }

    function setUnstakingDelay(uint256 seed) public {
        StRSRP1(address(main.stRSR())).setUnstakingDelay(uint48(between(1, 31536000, seed)));
    }

    function enableBatchTrade() public {
        BrokerP1Fuzz(address(main.broker())).enableBatchTrade();
    }

    function enableDutchTrade(IERC20Metadata erc20) public {
        BrokerP1Fuzz(address(main.broker())).enableDutchTrade(erc20);
    }

    function setShortFreeze(uint48 freeze) public {
        main.setShortFreeze(freeze);
    }

    function setLongFreeze(uint48 freeze) public {
        main.setLongFreeze(freeze);
    }

    function setIssuancePremiumEnabled(uint256 seed) public {
        BasketHandlerP1(address(main.basketHandler())).setIssuancePremiumEnabled((seed % 2) == 0);
    }

    // Grant/Revoke Roles
    function grantRole(uint8 which, uint8 userID) public {
        address user = main.someAddr(userID);
        which %= 4;
        if (which == 0) main.grantRole(OWNER, user);
        else if (which == 1) main.grantRole(SHORT_FREEZER, user);
        else if (which == 2) main.grantRole(LONG_FREEZER, user);
        else if (which == 3) main.grantRole(PAUSER, user);
    }

    function revokeRole(uint8 which, uint8 userID) public {
        address user = main.someAddr(userID);
        which %= 4;
        if (which == 0) main.revokeRole(OWNER, user);
        else if (which == 1) main.revokeRole(SHORT_FREEZER, user);
        else if (which == 2) main.revokeRole(LONG_FREEZER, user);
        else if (which == 3) main.revokeRole(PAUSER, user);
    }

    function setWithdrawalLeak(uint256 seed) public {
        StRSRP1(address(main.stRSR())).setWithdrawalLeak(uint48(between(0, 3e17, seed)));
    }

    function setWarmupPeriod(uint256 seed) public {
        BasketHandlerP1(address(main.basketHandler())).setWarmupPeriod(
            uint48(between(60, 31536000, seed))
        );
    }

    function resetStakes() public {
        main.stRSR().resetStakes();
    }

    // ====  Reentrancy Attack ====

    function setReentrancyAttack(uint8 tokenID, uint256 reentrancySeed) public {
        ERC20ReentrantFuzz token = ERC20ReentrantFuzz(address(main.someToken(tokenID)));
        bool shouldAttack = (reentrancySeed % 100) < 25; // 25% chance of attack enabled
        if (shouldAttack) {
            token.enableAttack();
        } else {
            token.disableAttack();
        }
    }

    function setReentrancyTarget(uint256 seed) public {
        reentrancyTarget = uint8(seed % 14); // 0-13 valid target functions
    }

    // ================ Internal functions / Helpers ================

    function someTargetName(uint256 seed) public view returns (bytes32) {
        uint256 id = seed % 3;
        return targetNames[id];
    }

    // @return the new token address
    function createToken(
        uint8 targetNameID,
        string memory namePrefix,
        string memory symbolPrefix
    ) public returns (ERC20ReentrantFuzz) {
        string memory targetStr = bytes32ToString(someTargetName(targetNameID));
        string memory idStr = Strings.toString(main.numTokens());

        ERC20ReentrantFuzz token = new ERC20ReentrantFuzz(
            concat(namePrefix, targetStr, " ", idStr),
            concat(symbolPrefix, targetStr, idStr),
            main,
            this
        );
        main.addToken(token);
        reentrantTokens.push(token);
        return token;
    }

    function createAsset(IERC20 erc20) public returns (AssetMock) {
        return
            new AssetMock({
                erc20_: IERC20Metadata(address(erc20)),
                maxTradeVolume_: defaultParams().rTokenMaxTradeVolume,
                priceTimeout_: 604800,
                oracleError_: 0.005e18,
                model_: volatile
            });
    }

    function createColl(
        IERC20 erc20,
        bool isStable,
        uint256 defaultThresholdSeed,
        uint48 delayUntilDefaultSeed,
        bytes32 targetName,
        uint256 revenueHidingSeed
    ) public returns (CollateralMock) {
        return
            new CollateralMock({
                erc20_: IERC20Metadata(address(erc20)),
                maxTradeVolume_: defaultParams().rTokenMaxTradeVolume,
                priceTimeout_: 806400,
                oracleError_: 0.005e18,
                defaultThreshold_: uint192(between(1, 1e18, defaultThresholdSeed)),
                delayUntilDefault_: uint48(between(1, type(uint48).max / 2, delayUntilDefaultSeed)),
                targetName_: targetName,
                refPerTokModel_: isStable ? growing : getNextPriceModel(),
                targetPerRefModel_: isStable ? justOne : getNextPriceModel(),
                uoaPerTargetModel_: isStable ? justOne : getNextPriceModel(),
                deviationModel_: isStable ? stable : getNextPriceModel(),
                revenueHiding: uint192(between(0, 1e18 - 1, revenueHidingSeed))
            });
    }

    function getNextPriceModel() internal returns (PriceModel memory) {
        if (priceModels.length == 0) return stable;
        uint256 currID = priceModelIndex;
        priceModelIndex = (priceModelIndex + 1) % priceModels.length; // next ID
        return priceModels[currID];
    }

    // ================ System Properties ================
    uint192 public prevRSRRate; // {StRSR/RSR}
    uint192 public prevRTokenRate; // {RTok/BU}

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

    // function echidna_ratesNeverFall() external view returns (bool) {
    //     if (rTokenRate() < prevRTokenRate) return false;
    //     return true;
    // }

    // Reentrancy helpers
    function attemptedReentrancies() public view returns (uint256 total) {
        for (uint256 i = 0; i < reentrantTokens.length; i++) {
            total += reentrantTokens[i].attemptedReentrancies();
        }
    }

    function blockedByGuardReentrancies() public view returns (uint256 total) {
        for (uint256 i = 0; i < reentrantTokens.length; i++) {
            total += reentrantTokens[i].blockedByGuardReentrancies();
        }
    }

    function failedReentrancies() public view returns (uint256 total) {
        for (uint256 i = 0; i < reentrantTokens.length; i++) {
            total += reentrantTokens[i].failedReentrancies();
        }
    }

    function reentrancySucceeded() public view returns (bool) {
        for (uint256 i = 0; i < reentrantTokens.length; i++) {
            if (reentrantTokens[i].reentrancySucceeded()) {
                return true;
            }
        }
        return false;
    }

    function getReentrantTokens() public view returns (ERC20ReentrantFuzz[] memory) {
        return reentrantTokens;
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

    // ==== Reentrancy  ====

    function echidna_no_reentrancy_succeeded() external view returns (bool) {
        return !reentrancySucceeded();
    }

    function echidna_all_reentrancies_revert() external view returns (bool) {
        return attemptedReentrancies() == failedReentrancies();
    }
}
