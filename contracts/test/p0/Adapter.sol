// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/p0/assets/ATokenFiatCollateral.sol";
import "contracts/p0/assets/CTokenFiatCollateral.sol";
import "contracts/p0/assets/CompoundPricedFiatCollateral.sol";
import "contracts/p0/assets/AavePricedFiatCollateral.sol";
import "contracts/p0/assets/CompoundPricedAsset.sol";
import "contracts/p0/assets/AavePricedAsset.sol";
import "contracts/p0/interfaces/IAsset.sol";
import "contracts/p0/interfaces/IDeployer.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/interfaces/IRToken.sol";
import "contracts/p0/interfaces/IStRSR.sol";
import "contracts/p0/mocks/AaveLendingPoolMock.sol";
import "contracts/p0/mocks/AaveLendingAddrProviderMock.sol";
import "contracts/p0/mocks/AaveOracleMock.sol";
import "contracts/p0/mocks/CompoundOracleMock.sol";
import "contracts/p0/mocks/ComptrollerMock.sol";
import "contracts/p0/mocks/RTokenMock.sol";
import "contracts/mocks/ATokenMock.sol";
import "contracts/mocks/CTokenMock.sol";
import "contracts/mocks/ERC20Mock.sol";
import "contracts/mocks/MarketMock.sol";
import "contracts/mocks/USDCMock.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/test/Lib.sol";
import "contracts/test/ProtosDriver.sol";
import "contracts/test/ProtoState.sol";

import "./DeployerExtension.sol";
import "./MainExtension.sol";
import "./RTokenExtension.sol";
import "./StRSRExtension.sol";

import "hardhat/console.sol";

contract AdapterP0 is ProtoAdapter {
    using FixLib for Fix;
    using Lib for ProtoState;

    string constant ETH = "ETH";
    uint256 constant NUM_COLLATERAL = 11;
    uint256 constant NUM_ASSETS = 14;

    // Deployed system contracts
    DeployerExtension internal deployer;
    MainExtension internal main;
    StRSRExtension internal stRSR;
    RTokenExtension internal rToken;
    ERC20Mock internal rsr;

    // Trading
    MarketMock internal market;

    // Mock Oracles for price-setting
    CompoundOracleMockP0 internal compoundOracle;
    AaveOracleMockP0 internal aaveOracle;

    IComptroller internal comptroller;
    IAaveLendingPool internal aaveLendingPool;

    mapping(AssetName => IAsset) internal assets;

    // erc20 address -> AssetName
    mapping(address => AssetName) internal reverseAssets;

    function init(ProtoState memory s) external override {
        // Deploy oracles
        compoundOracle = new CompoundOracleMockP0();
        compoundOracle.setPrice(ETH, s.ethPrice.inUoA);

        comptroller = new ComptrollerMockP0(address(compoundOracle));
        aaveOracle = new AaveOracleMockP0(address(new ERC20Mock("Wrapped ETH", "WETH")));
        aaveOracle.setPrice(aaveOracle.WETH(), s.ethPrice.inETH);
        aaveLendingPool = new AaveLendingPoolMockP0(
            address(new AaveLendingAddrProviderMockP0(address(aaveOracle)))
        );

        // Deploy ERC20 + Asset, set oracle prices, initialize balances, set defi
        for (uint256 i = 0; i < NUM_COLLATERAL; i++) {
            deployAsset(i, s.assets[i], s.rateToRef[i], s.prices[i]);
        }

        // Deploy Market + Deployer
        market = new MarketMock();
        deployer = new DeployerExtension(
            assets[AssetName.RSR].erc20(),
            assets[AssetName.COMP].erc20(),
            assets[AssetName.AAVE].erc20(),
            market,
            comptroller,
            aaveLendingPool
        );

        // Calculate revenue cuts
        RevenueShare memory initialShare;
        RevenueDistributorP0 throwawayDistributor = new RevenueDistributorP0(); // just for reading out constants
        for (uint256 i = 0; i < s.distribution.length; i++) {
            if (s.distribution[i].dest == throwawayDistributor.FURNACE()) {
                initialShare.rTokenDist = s.distribution[i].rTokenDist;
            } else if (s.distribution[i].dest == throwawayDistributor.ST_RSR()) {
                initialShare.rsrDist = s.distribution[i].rsrDist;
            }
        }

        // Deploy Main + StRSR + RToken
        main = MainExtension(
            deployer.deploy(s.rToken.name, s.rToken.symbol, address(this), s.config, initialShare)
        );
        rsr = ERC20Mock(address(main.rsr()));
        stRSR = StRSRExtension(address(main.stRSR()));
        rToken = RTokenExtension(address(main.rToken()));

        // Init RToken balances
        for (uint256 i = 0; i < s.rToken.balances.length; i++) {
            if (s.rToken.balances[i] > 0) {
                ICollateral[] memory backing = main.basketCollateral();
                uint256[] memory quantities = main.issuanceQuote(s.rToken.balances[i]);
                address acc = toAddress(Account(i));
                address _main = toAddress(Account.MAIN);
                for (uint256 j = 0; j < backing.length; j++) {
                    ERC20Mock(address(backing[j].erc20())).mint(acc, quantities[j]);
                    ERC20Mock(address(backing[j].erc20())).adminApprove(acc, _main, quantities[j]);
                }
                main.issueInstantly(acc, s.rToken.balances[i]);
                assert(rToken.balanceOf(acc) == s.rToken.balances[i]);
            }
        }
        assert(rToken.totalSupply() == s.rToken.totalSupply);

        // Init StRSR balances
        // StRSR.balance = RSR.mint + StRSR.stake
        for (uint256 i = 0; i < s.stRSR.balances.length; i++) {
            if (s.stRSR.balances[i] > 0) {
                address acc = toAddress(Account(i));
                rsr.mint(acc, s.stRSR.balances[i]);
                rsr.adminApprove(acc, toAddress(Account.STRSR), s.stRSR.balances[i]);
                stRSR.connect(acc);
                stRSR.stake(s.stRSR.balances[i]);
            }
        }
        assert(stRSR.totalSupply() == s.stRSR.totalSupply);

        // add remaining distribution
        main.connect(address(this));
        for (uint256 i = 0; i < s.distribution.length; i++) {
            if (
                s.distribution[i].dest != throwawayDistributor.FURNACE() &&
                s.distribution[i].dest != throwawayDistributor.ST_RSR()
            ) {
                main.setDistribution(
                    s.distribution[i].dest,
                    RevenueShare(s.distribution[i].rTokenDist, s.distribution[i].rsrDist)
                );
            }
        }

        // Set basket configuration + unpause
        ICollateral[] memory collateral = new ICollateral[](s.basket.backing.length);
        for (uint256 i = 0; i < collateral.length; i++) {
            collateral[i] = ICollateral(address(assets[s.basket.backing[i]]));
        }
        main.setPrimeBasket(collateral, s.basket.targetAmts);
        ICollateral[] memory backups = new ICollateral[](s.basket.backupCollateral.length);
        for (uint256 i = 0; i < backups.length; i++) {
            backups[i] = ICollateral(address(assets[s.basket.backupCollateral[i]]));
        }
        main.setBackupConfig(bytes32(bytes("USD")), s.basket.maxSize, backups);
        main.unpause();
    }

    function state() public view override returns (ProtoState memory s) {
        s.config = Config(
            main.rewardStart(),
            main.rewardPeriod(),
            main.auctionPeriod(),
            main.stRSRWithdrawalDelay(),
            main.defaultDelay(),
            main.maxTradeSlippage(),
            main.maxAuctionSize(),
            main.minAuctionSize(),
            main.issuanceRate(),
            main.defaultThreshold()
        );
        s.distribution = main.distributionState();
        s.rToken = dumpERC20(main.rToken());
        s.stRSR = dumpERC20(main.stRSR());
        s.basket = basketState();
        s.assets = new TokenState[](NUM_ASSETS);
        s.prices = new Price[](NUM_ASSETS); // empty
        for (uint256 i = 0; i < NUM_ASSETS; i++) {
            IERC20Metadata erc20 = IERC20Metadata(address(assets[AssetName(i)].erc20()));
            s.assets[i] = dumpERC20(erc20);
            s.prices[i] = Price(
                aaveOracle.getAssetPrice(address(erc20)),
                compoundOracle.price(erc20.symbol())
            );
        }
        s.rateToRef = new Fix[](NUM_COLLATERAL);
        for (uint256 i = 0; i < NUM_COLLATERAL; i++) {
            s.rateToRef[i] = ICollateral(address(assets[AssetName(i)])).refPerTok();
        }
        s.ethPrice = Price(aaveOracle.getAssetPrice(aaveOracle.WETH()), compoundOracle.price(ETH));
    }

    function assertEq(ProtoState memory s) external view override {
        state().assertEq(s);
    }

    function assertInvariants() external view override {
        deployer.assertInvariants();
        main.assertInvariants();
        rToken.assertInvariants();
        stRSR.assertInvariants();
    }

    // === COMMANDS ====

    function CMD_issue(Account account, uint256 amount) external override {
        main.connect(toAddress(account));
        ICollateral[] memory collateral = main.basketCollateral();
        uint256[] memory quantities = main.issuanceQuote(amount);
        assert(collateral.length == quantities.length);
        for (uint256 i = 0; i < collateral.length; i++) {
            ERC20Mock(address(collateral[i].erc20())).adminApprove(
                toAddress(account),
                address(main),
                quantities[i]
            );
        }
        main.issue(amount);
    }

    function CMD_redeem(Account account, uint256 amount) external override {
        main.connect(toAddress(account));
        main.redeem(amount);
    }

    function CMD_poke() external virtual override {
        main.poke();
        fillAuctions();
    }

    function CMD_stakeRSR(Account account, uint256 amount) external override {
        rsr.adminApprove(toAddress(account), toAddress(Account.STRSR), amount);
        stRSR.connect(toAddress(account));
        stRSR.stake(amount);
    }

    function CMD_unstakeRSR(Account account, uint256 amount) external override {
        stRSR.connect(toAddress(account));
        stRSR.unstake(amount);
    }

    function CMD_transferRToken(
        Account from,
        Account to,
        uint256 amount
    ) external override {
        rToken.connect(toAddress(from));
        rToken.transfer(toAddress(to), amount);
    }

    function CMD_transferStRSR(
        Account from,
        Account to,
        uint256 amount
    ) external override {
        stRSR.connect(toAddress(from));
        stRSR.transfer(toAddress(to), amount);
    }

    // =================================================================

    /// @param token The ERC20 token
    function dumpERC20(IERC20 token) internal view returns (TokenState memory tokenState) {
        IERC20Metadata erc20 = IERC20Metadata(address(token));
        tokenState.name = erc20.name();
        tokenState.symbol = erc20.symbol();
        tokenState.balances = new uint256[](uint256(type(Account).max) + 1);
        for (uint256 i = 0; i < uint256(type(Account).max) + 1; i++) {
            tokenState.balances[i] = erc20.balanceOf(toAddress(Account(i)));
        }
        tokenState.totalSupply = erc20.totalSupply();
    }

    function deployAsset(
        uint256 i,
        TokenState memory tokenState,
        Fix rateToRef,
        Price memory price
    ) internal {
        // ERC20
        ERC20Mock erc20;
        if (i == 1) {
            erc20 = new USDCMock(tokenState.name, tokenState.symbol);
        } else if (i < 4 || i >= NUM_COLLATERAL) {
            erc20 = new ERC20Mock(tokenState.name, tokenState.symbol);
        } else if (i < 7) {
            address fiatcoin = address(assets[AssetName(i - 4)].erc20());
            erc20 = new CTokenMock(tokenState.name, tokenState.symbol, fiatcoin);
            CTokenMock(address(erc20)).setExchangeRate(rateToRef);
        } else {
            address fiatcoin = address(assets[AssetName(i - 7)].erc20());
            erc20 = new StaticATokenMock(tokenState.name, tokenState.symbol, fiatcoin);
            StaticATokenMock(address(erc20)).setExchangeRate(rateToRef);
        }
        reverseAssets[address(erc20)] = AssetName(i);

        // Balances
        for (uint256 j = 0; j < tokenState.balances.length; j++) {
            if (tokenState.balances[j] > 0) {
                // Use 0x1, 0x2...
                erc20.mint(toAddress(Account(j)), tokenState.balances[j]);
            }
        }
        assert(erc20.totalSupply() == tokenState.totalSupply);

        // Asset
        IAsset asset;
        if (i == 2) {
            // USDT is the only compound fiatcoin
            asset = new CompoundPricedFiatCollateralP0(erc20, main, comptroller);
        } else if (i < 4) {
            asset = new AavePricedFiatCollateralP0(erc20, main, comptroller, aaveLendingPool);
        } else if (i < 7) {
            asset = new CTokenFiatCollateralP0(
                erc20,
                assets[AssetName(i - 4)].erc20(),
                main,
                comptroller,
                CompoundClaimAdapterP0(address(deployer.compoundClaimer()))
            );
        } else if (i < 11) {
            asset = new ATokenFiatCollateralP0(
                erc20,
                assets[AssetName(i - 7)].erc20(),
                main,
                comptroller,
                aaveLendingPool,
                AaveClaimAdapterP0(address(deployer.aaveClaimer()))
            );
        } else {
            asset = new AavePricedAssetP0(erc20, comptroller, aaveLendingPool);
        }
        assets[AssetName(i)] = asset;

        // Oracle prices
        if (i < 4 || i >= NUM_COLLATERAL) {
            aaveOracle.setPrice(address(erc20), price.inETH);
            compoundOracle.setPrice(erc20.symbol(), price.inUoA);
            assert(assets[AssetName(i)].price().eq(toFix(price.inUoA)));
        }
    }

    function basketState() internal view returns (BasketState memory basket) {
        ICollateral[] memory basketCollateral = main.basketCollateral();
        basket.backing = new AssetName[](basketCollateral.length);
        for (uint256 i = 0; i < basketCollateral.length; i++) {
            basket.backing[i] = reverseAssets[address(basketCollateral[i].erc20())];
        }
        BackupConfig memory bc = main.backupConfig();
        basket.backupCollateral = new AssetName[](bc.collateral.length);
        for (uint256 i = 0; i < bc.collateral.length; i++) {
            basket.backupCollateral[i] = reverseAssets[address(bc.collateral[i].erc20())];
        }
        basket.qTokAmts = main.issuanceQuote(FIX_ONE.round());
        basket.refAmts = main.basketRefAmts();
    }

    /// Uses Account.TRADER as auction counterparty for all auctions
    function fillAuctions() internal {
        uint256 numAuctions = market.numAuctions();
        for (uint256 i = 0; i < numAuctions; i++) {
            (, IERC20 sell, IERC20 buy, uint256 sellAmount, , , , AuctionStatus status) = market
                .auctions(i);
            (address bidder, , ) = market.bids(i);
            if (status == AuctionStatus.OPEN && bidder == address(0)) {
                Bid memory newBid;
                newBid.bidder = toAddress(Account.TRADER);
                newBid.sellAmount = sellAmount;
                IAsset sellAsset = assets[reverseAssets[address(sell)]];
                IAsset buyAsset = assets[reverseAssets[address(buy)]];
                newBid.buyAmount = toFix(sellAmount)
                    .mul(buyAsset.price())
                    .div(sellAsset.price())
                    .ceil();
                ERC20Mock(address(buy)).mint(newBid.bidder, newBid.buyAmount);
                ERC20Mock(address(buy)).adminApprove(
                    newBid.bidder,
                    address(market),
                    newBid.buyAmount
                );
                market.placeBid(i, newBid);
            }
        }
    }

    /// Account -> address
    function toAddress(Account account) internal view returns (address) {
        if (account == Account.RTOKEN) {
            return address(rToken);
        } else if (account == Account.STRSR) {
            return address(stRSR);
        } else if (account == Account.MAIN) {
            return address(main);
        }

        // EOA: Use 0x1, 0x2, ...
        return address((uint160(account) + 1));
    }
}
