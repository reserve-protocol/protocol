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

// solhint-disable max-states-count

// The "chaos operations" fuzzing scenario, in which:
// - Tokens may default
// - The basket may change after initialization
// - Significant governance changes occur
contract ChaosOpsScenario {
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

    // Used to create unique asset/col symbols - Starts with 3 to avoid collisions
    uint256 internal tokenIdNonce = 3;

    // Register and track priceModels that can be used in new assets/collateral
    PriceModel[] public priceModels;
    uint256 internal priceModelIndex;

    // Once constructed, everything is set up for random echidna runs to happen:
    // - main and its components are up
    // - standard tokens, and their Assets and Collateral, exist
    // - standard basket is configured
    // - at least one user has plenty of starting tokens
    constructor() {
        main = new MainP1Fuzz();

        main.initFuzz(defaultParams(), new MarketMock(main, SettlingMode.Random));

        uint192 maxTradeVolume = defaultParams().rTokenMaxTradeVolume;

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

                ERC20Fuzz token = new ERC20Fuzz(
                    concat(concat(concat("Collateral", targetNameStr), " "), num),
                    concat(concat("C", targetNameStr), num),
                    main
                );
                main.addToken(token);

                if (k < 2) {
                    ERC20Fuzz reward = new ERC20Fuzz(
                        concat(concat(concat("Reward", targetNameStr), " "), num),
                        concat(concat("R", targetNameStr), num),
                        main
                    );
                    main.addToken(reward);
                    token.setRewardToken(reward);
                    main.assetRegistry().register(createAsset(reward));
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
                        deviationModel_: [stable, volatile, volatile][k]
                    })
                );
                collateralTokens.push(IERC20(token));
            }

            // Create three stable backup tokens for each target name
            for (uint256 j = 0; j < 3; j++) {
                string memory num = Strings.toString(j);
                ERC20Fuzz token = new ERC20Fuzz(
                    concat(concat("Stable", targetNameStr), num),
                    concat(concat("S", targetNameStr), num),
                    main
                );
                main.addToken(token);
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
                        deviationModel_: justOne
                    })
                );
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
        bool isStable
    ) public {
        bytes32 targetName = someTargetName(targetNameID);
        IAssetRegistry reg = main.assetRegistry();
        IERC20 erc20 = main.someToken(tokenID);
        require(!reg.isRegistered(erc20), "token already registered");

        if (isColl) {
            reg.register(
                createColl(erc20, isStable, defaultThresholdSeed, delayUntilDefaultSeed, targetName)
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
        uint256 stableOrRandomSeed
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
                CollateralMock(address(asset)).targetName()
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

    // ==== user functions: rtoken ====

    // Issuance "span" model, to track changes to the rtoken supply, so we can flag failure if
    // supply grows faster than the issuance rate

    // startBlock is the block when the current "issuance span" began
    // issuance span: a span of blocks during which some issuance is not yet vested
    // At any point in any issuance span:
    //   vested / (block.numer - startBlock) > maxIssuanceRate * max_span(totalSupply)

    // So span model:
    uint256 public spanStartBlock;
    uint256 public spanPending;
    uint256 public spanVested;
    uint256 public spanMaxSupply;

    function noteQuickIssuance(uint256 amount) internal {
        if (spanPending == 0) spanStartBlock = block.number;
        spanVested += amount;

        uint256 supply = main.rToken().totalSupply();
        spanMaxSupply = supply > spanMaxSupply ? supply : spanMaxSupply;
    }

    function noteIssuance(uint256 amount) internal {
        if (spanPending == 0) spanStartBlock = block.number;
        spanPending += amount;

        uint256 supply = main.rToken().totalSupply();
        spanMaxSupply = supply > spanMaxSupply ? supply : spanMaxSupply;
    }

    function noteVesting(uint256 amount) internal {
        if (spanPending >= amount) {
            emit AssertionFailure("in noteVesting(amount), spanPending < amount");
        }
        spanPending -= amount;
        spanVested += amount;

        // {Rtok/block}
        uint192 minRate = FIX_ONE * 10_000;
        // {Rtok/block}
        RTokenP1Fuzz rtoken = RTokenP1Fuzz(address(main.rToken()));

        uint256 supplyRate = rtoken.issuanceRate().mulu(rtoken.totalSupply());
        uint192 issRate = uint192(Math.min(minRate, supplyRate));
        if (spanVested < issRate.mulu(block.number - spanStartBlock + 1)) {
            emit AssertionFailure("Issuance and vesting speed too high");
        }
    }

    // do issuance without doing allowances first
    function justIssue(uint256 amount) public asSender {
        uint256 preSupply = main.rToken().totalSupply();

        main.rToken().issue(amount);

        uint256 postSupply = main.rToken().totalSupply();

        if (postSupply == preSupply) noteIssuance(amount);
        else noteQuickIssuance(amount);

        assertRTokenIssuances(msg.sender);
    }

    // do issuance without doing allowances first, to a different recipient
    function justIssueTo(uint256 amount, uint8 recipientID) public asSender {
        address recipient = main.someAddr(recipientID);
        uint256 preSupply = main.rToken().totalSupply();

        main.rToken().issue(recipient, amount);

        uint256 postSupply = main.rToken().totalSupply();

        if (postSupply == preSupply) noteIssuance(amount);
        else noteQuickIssuance(amount);

        assertRTokenIssuances(recipient);
    }

    // do allowances as needed, and *then* do issuance
    function issue(uint256 amount) public asSender {
        uint256 preSupply = main.rToken().totalSupply();
        require(amount + preSupply <= 1e48, "Do not issue 'unreasonably' many rTokens");

        address[] memory tokens;
        uint256[] memory tokenAmounts;
        (tokens, tokenAmounts) = (RTokenP1Fuzz(address(main.rToken()))).quote(amount, CEIL);
        for (uint256 i = 0; i < tokens.length; i++) {
            IERC20(tokens[i]).approve(address(main.rToken()), tokenAmounts[i]);
        }
        main.rToken().issue(amount);

        uint256 postSupply = main.rToken().totalSupply();

        if (postSupply == preSupply) noteIssuance(amount);
        else noteQuickIssuance(amount);

        assertRTokenIssuances(msg.sender);
    }

    // do allowances as needed, and *then* do issuance
    function issueTo(uint256 amount, uint8 recipientID) public asSender {
        address recipient = main.someAddr(recipientID);
        uint256 preSupply = main.rToken().totalSupply();
        require(amount + preSupply <= 1e48, "Do not issue 'unreasonably' many rTokens");

        address[] memory tokens;
        uint256[] memory tokenAmounts;
        (tokens, tokenAmounts) = (RTokenP1Fuzz(address(main.rToken()))).quote(amount, CEIL);
        for (uint256 i = 0; i < tokens.length; i++) {
            IERC20(tokens[i]).approve(address(main.rToken()), tokenAmounts[i]);
        }
        main.rToken().issue(recipient, amount);

        uint256 postSupply = main.rToken().totalSupply();

        if (postSupply == preSupply) noteIssuance(amount);
        else noteQuickIssuance(amount);

        assertRTokenIssuances(recipient);
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
        uint256 preSupply = rtoken.totalSupply();

        (uint256 left, uint256 right) = rtoken.idRange(user);
        uint256 id = between(left == 0 ? 0 : left - 1, right + 1, seedID);

        // Do vest
        rtoken.vest(user, id);

        uint256 postSupply = rtoken.totalSupply();
        noteVesting(postSupply - preSupply);
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
        which %= 4;
        if (which == 0) main.rTokenTrader().claimRewards();
        else if (which == 1) main.rsrTrader().claimRewards();
        else if (which == 2) main.backingManager().claimRewards();
        else if (which == 3) main.rToken().claimRewards();
    }

    function sweepRewards() public {
        main.rToken().sweepRewards();
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

    function manageBackingTokens() public {
        main.backingManager().manageTokens(backingToManage);
    }

    function manageTokenInRSRTrader(uint256 tokenID) public {
        IERC20 token = main.someToken(tokenID);
        main.rsrTrader().manageToken(token);
    }

    function manageTokenInRTokenTrader(uint256 tokenID) public {
        IERC20 token = main.someToken(tokenID);
        main.rTokenTrader().manageToken(token);
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
        main.distributor().distribute(token, main.someAddr(fromID), amount);
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
        main.unspoof(address(this));

        main.distributor().distribute(token, fromUser, amount);
    }

    function payRSRProfits() public {
        main.stRSR().payoutRewards();
    }

    function payRTokenProfits() public {
        main.furnace().melt();
        assertFurnacePayouts();
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

    function setPrimeBasket() public {
        BasketHandlerP1Fuzz bh = BasketHandlerP1Fuzz(address(main.basketHandler()));
        bh.setPrimeBasket(backingForPrimeBasket, targetAmtsForPrimeBasket);
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

    function pause() public asSender {
        main.pause();
    }

    function unpause() public asSender {
        main.unpause();
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
            uint192(between(0, 1e18, seed))
        ); // 1e18 == MAX_BACKING_BUFFER
    }

    function setBackingManagerTradingDelay(uint256 seed) public {
        BackingManagerP1(address(main.backingManager())).setTradingDelay(
            uint48(between(0, 31536000, seed))
        ); // 31536000 is BackingManager.MAX_TRADING_DELAY
    }

    function setAuctionLength(uint256 seed) public {
        BrokerP1(address(main.broker())).setAuctionLength(uint48(between(1, 604800, seed)));
        // 604800 is Broker.MAX_AUCTION_LENGTH
    }

    function setFurnacePeriod(uint256 seed) public {
        FurnaceP1(address(main.furnace())).setPeriod(uint48(between(1, 31536000, seed)));
        // 31536000 is Furnace.MAX_PERIOD
    }

    function setFurnaceRatio(uint256 seed) public {
        FurnaceP1(address(main.furnace())).setRatio(uint192(between(0, 1e18, seed)));
        // 1e18 is Furnace.MAX_RATIO
    }

    function setIssuanceRate(uint256 seed) public {
        RTokenP1(address(main.rToken())).setIssuanceRate(uint192(between(0, 1e18, seed)));
        // 1e18 is RToken.MAX_ISSUANCE_RATE
    }

    function setScalingRedemptionRate(uint256 seed) public {
        RTokenP1(address(main.rToken())).setScalingRedemptionRate(uint192(between(0, 1e18, seed)));
        // 1e18 is RToken.MAX_REDEMPTION
    }

    function setRedemptionRateFloor(uint256 value) public {
        RTokenP1(address(main.rToken())).setRedemptionRateFloor(value);
    }

    function setRSRTraderMaxTradeSlippage(uint256 seed) public {
        RevenueTraderP1(address(main.rsrTrader())).setMaxTradeSlippage(
            uint192(between(0, 1e18, seed))
        );
        // 1e18 is Trading.MAX_TRADE_SLIPPAGE
    }

    function setRTokenTraderMaxTradeSlippage(uint256 seed) public {
        RevenueTraderP1(address(main.rTokenTrader())).setMaxTradeSlippage(
            uint192(between(0, 1e18, seed))
        );
        // 1e18 is Trading.MAX_TRADE_SLIPPAGE
    }

    function setBackingManagerMaxTradeSlippage(uint256 seed) public {
        BackingManagerP1(address(main.backingManager())).setMaxTradeSlippage(
            uint192(between(0, 1e18, seed))
        );
        // 1e18 is Trading.MAX_TRADE_SLIPPAGE
    }

    function setStakeRewardPeriod(uint256 seed) public {
        StRSRP1(address(main.stRSR())).setRewardPeriod(uint48(between(1, 31536000, seed)));
    }

    function setStakeRewardRatio(uint256 seed) public {
        StRSRP1(address(main.stRSR())).setRewardRatio(uint192(between(1, 1e18, seed)));
    }

    function setUnstakingDelay(uint256 seed) public {
        StRSRP1(address(main.stRSR())).setUnstakingDelay(uint48(between(1, 31536000, seed)));
    }

    function setBrokerDisabled(bool disabled) public {
        BrokerP1Fuzz(address(main.broker())).setDisabled(disabled);
    }

    function setShortFreeze(uint48 freeze) public {
        main.setShortFreeze(freeze);
    }

    function setLongFreeze(uint48 freeze) public {
        main.setLongFreeze(freeze);
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
    ) public returns (ERC20Fuzz) {
        string memory targetStr = bytes32ToString(someTargetName(targetNameID));
        string memory idStr = Strings.toString(main.numTokens());

        ERC20Fuzz token = new ERC20Fuzz(
            concat(namePrefix, targetStr, " ", idStr),
            concat(symbolPrefix, targetStr, idStr),
            main
        );
        main.addToken(token);
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
        bytes32 targetName
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
                deviationModel_: isStable ? stable : getNextPriceModel()
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
            main.rToken().basketsNeeded() == 0
                ? FIX_ONE
                : uint192((FIX_ONE * main.rToken().totalSupply()) / main.rToken().basketsNeeded());
    }

    // pseudo-mutator for saving old rates...
    function saveRates() public {
        prevRSRRate = main.stRSR().exchangeRate();
        prevRTokenRate = rTokenRate();
    }

    function assertRTokenIssuances(address user) public view {
        RTokenP1Fuzz(address(main.rToken())).assertIssuances(user);
    }

    function assertFurnacePayouts() public view {
        FurnaceP1Fuzz(address(main.furnace())).assertPayouts();
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

    function echidna_rTokenInvariants() external view returns (bool) {
        return RTokenP1Fuzz(address(main.rToken())).invariantsHold();
    }

    function echidna_stRSRInvariants() external view returns (bool) {
        return StRSRP1Fuzz(address(main.stRSR())).invariantsHold();
    }
}
