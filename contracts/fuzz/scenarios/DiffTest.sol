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

    IMainFuzz[2] public p;

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

            main.initFuzz(defaultParams(), new MarketMock(main));

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
                        0,
                        0,
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
            require(address(token) != address(p[N].rToken()), "Do not just mint RTokens");
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
            require(address(token) != address(p[N].rToken()), "Do not just burn RTokens");
            ERC20Fuzz(address(token)).burn(p[N].someUser(userID), amount);
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

    function grantAllowances(uint256 tokenID) public {
        for (uint256 N = 0; N < 2; N++) {
            p[N].backingManager().grantRTokenAllowance(p[N].someToken(tokenID));
        }
    }

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
                uint192(between(seed, 0, 1e18))
            ); // 1e18 == MAX_BACKING_BUFFER
        }
    }

    function setBackingManagerTradingDelay(uint256 seed) public {
        for (uint256 N = 0; N < 2; N++) {
            TestIBackingManager(address(p[N].backingManager())).setTradingDelay(
                uint48(between(seed, 0, 31536000))
            ); // 31536000 is BackingManager.MAX_TRADING_DELAY
        }
    }

    function setAuctionLength(uint256 seed) public {
        for (uint256 N = 0; N < 2; N++) {
            TestIBroker(address(p[N].broker())).setAuctionLength(uint48(between(seed, 1, 604800)));
            // 604800 is Broker.MAX_AUCTION_LENGTH
        }
    }

    function setFurnacePeriod(uint256 seed) public {
        for (uint256 N = 0; N < 2; N++) {
            p[N].furnace().setPeriod(uint48(between(seed, 1, 31536000)));
            // 31536000 is Furnace.MAX_PERIOD
        }
    }

    function setFurnaceRatio(uint256 seed) public {
        for (uint256 N = 0; N < 2; N++) {
            p[N].furnace().setRatio(uint192(between(seed, 0, 1e18)));
            // 1e18 is Furnace.MAX_RATIO
        }
    }

    function setIssuanceRate(uint256 seed) public {
        for (uint256 N = 0; N < 2; N++) {
            TestIRToken(address(p[N].rToken())).setIssuanceRate(uint192(between(seed, 0, 1e18)));
            // 1e18 is RToken.MAX_ISSUANCE_RATE
        }
    }

    function setRSRTraderMaxTradeSlippage(uint256 seed) public {
        for (uint256 N = 0; N < 2; N++) {
            TestITrading(address(p[N].rsrTrader())).setMaxTradeSlippage(
                uint192(between(seed, 0, 1e18))
            );
            // 1e18 is Trading.MAX_TRADE_SLIPPAGE
        }
    }

    function setRTokenTraderMaxTradeSlippage(uint256 seed) public {
        for (uint256 N = 0; N < 2; N++) {
            TestITrading(address(p[N].rTokenTrader())).setMaxTradeSlippage(
                uint192(between(seed, 0, 1e18))
            );
            // 1e18 is Trading.MAX_TRADE_SLIPPAGE
        }
    }

    function setBackingManagerMaxTradeSlippage(uint256 seed) public {
        for (uint256 N = 0; N < 2; N++) {
            TestITrading(address(p[N].backingManager())).setMaxTradeSlippage(
                uint192(between(seed, 0, 1e18))
            );
            // 1e18 is Trading.MAX_TRADE_SLIPPAGE
        }
    }

    function setStakeRewardPeriod(uint256 seed) public {
        for (uint256 N = 0; N < 2; N++) {
            TestIStRSR(address(p[N].stRSR())).setRewardPeriod(uint48(between(seed, 1, 31536000)));
        }
    }

    function setStakeRewardRatio(uint256 seed) public {
        for (uint256 N = 0; N < 2; N++) {
            TestIStRSR(address(p[N].stRSR())).setRewardRatio(uint192(between(seed, 1, 1e18)));
        }
    }

    function setUnstakingDelay(uint256 seed) public {
        for (uint256 N = 0; N < 2; N++) {
            TestIStRSR(address(p[N].stRSR())).setUnstakingDelay(uint48(between(seed, 1, 31536000)));
        }
    }

    // ================ Equivalence Properties ================
    function echidna_rTokenSuppliesEqual() public view returns (bool) {
        return p[0].rToken().totalSupply() == p[1].rToken().totalSupply();
    }

    function echidna_stRSRSuppliesEqual() public view returns (bool) {
        return p[0].stRSR().totalSupply() == p[1].stRSR().totalSupply();
    }

    function echidna_allBalancesEqual() public view returns (bool) {
        if (p[0].numUsers() != p[1].numUsers()) return false;
        if (p[0].numTokens() != p[1].numTokens()) return false;

        for (uint256 u = 0; u < p[0].numUsers(); u++) {
            for (uint256 t = 0; t < p[0].numTokens() + 2; t++) {
                uint256 bal0 = p[0].someToken(t).balanceOf(p[0].users(u));
                uint256 bal1 = p[1].someToken(t).balanceOf(p[1].users(u));
                if (bal0 != bal1) return false;
            }
        }
        return true;
    }
}
