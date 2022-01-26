// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/libraries/test/strings.sol";
import "contracts/mocks/ATokenMock.sol";
import "contracts/mocks/CTokenMock.sol";
import "contracts/mocks/ERC20Mock.sol";
import "contracts/mocks/MarketMock.sol";
import "contracts/mocks/USDCMock.sol";
import "contracts/p0/Collateral.sol";
import "contracts/p0/assets/ATokenCollateral.sol";
import "contracts/p0/assets/CTokenCollateral.sol";
import "contracts/p0/interfaces/IAsset.sol";
import "contracts/p0/interfaces/IDeployer.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/interfaces/IRToken.sol";
import "contracts/p0/interfaces/IStRSR.sol";
import "contracts/p0/interfaces/IOracle.sol";
import "contracts/p0/mocks/AaveLendingPoolMock.sol";
import "contracts/p0/mocks/AaveLendingAddrProviderMock.sol";
import "contracts/p0/mocks/AaveOracleMock.sol";
import "contracts/p0/mocks/CompoundOracleMock.sol";
import "contracts/p0/mocks/ComptrollerMock.sol";
import "contracts/p0/mocks/RTokenMock.sol";
import "contracts/p0/Oracle.sol";
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
    using strings for string;
    using strings for strings.slice;

    string constant ETH = "ETH";
    uint256 constant NUM_FIATCOINS = 4;
    uint256 constant NUM_COLLATERAL = 11;
    uint256 constant NUM_ASSETS = 14;

    // Deployed system contracts
    DeployerExtension internal _deployer;
    ERC20Mock internal _rsr;
    ERC20Mock internal _comp;
    ERC20Mock internal _aave;
    MainExtension internal _main;
    StRSRExtension internal _stRSR;
    RTokenExtension internal _rToken;

    // Trading
    MarketMock internal _market;

    // Mock Oracles for price-setting
    CompoundOracleMockP0 internal _compoundOracle;
    AaveOracleMockP0 internal _aaveOracle;

    // Our Oracles
    IOracle internal _ourCompoundOracle;
    IOracle internal _ourAaveOracle;

    // Collateral
    mapping(AssetName => IAsset) internal _assets;
    mapping(ERC20Mock => AssetName) internal _reverseAssets;

    function init(ProtoState memory s) external override {
        // Deploy oracles
        {
            _compoundOracle = new CompoundOracleMockP0();
            _compoundOracle.setPrice(ETH, s.ethPrice.inUSD);

            IComptroller comptroller = new ComptrollerMockP0(address(_compoundOracle));
            _aaveOracle = new AaveOracleMockP0(address(new ERC20Mock("Wrapped ETH", "WETH")));
            _aaveOracle.setPrice(_aaveOracle.WETH(), s.ethPrice.inETH);
            IAaveLendingPool aaveLendingPool = new AaveLendingPoolMockP0(
                address(new AaveLendingAddrProviderMockP0(address(_aaveOracle)))
            );

            _ourCompoundOracle = new CompoundOracle(comptroller);
            _ourAaveOracle = new AaveOracle(comptroller, aaveLendingPool);
        }

        // Deploy assets + deployer
        ICollateral[] memory collateral = new ICollateral[](NUM_COLLATERAL);
        {
            ERC20Mock dai = new ERC20Mock(s.collateral[0].name, s.collateral[0].symbol);
            USDCMock usdc = new USDCMock(s.collateral[1].name, s.collateral[1].symbol);
            ERC20Mock usdt = new ERC20Mock(s.collateral[2].name, s.collateral[2].symbol);
            ERC20Mock busd = new ERC20Mock(s.collateral[3].name, s.collateral[3].symbol);
            CTokenMock cDAI = new CTokenMock(
                s.collateral[4].name,
                s.collateral[4].symbol,
                address(dai)
            );
            CTokenMock cUSDC = new CTokenMock(
                s.collateral[5].name,
                s.collateral[5].symbol,
                address(usdc)
            );
            CTokenMock cUSDT = new CTokenMock(
                s.collateral[6].name,
                s.collateral[6].symbol,
                address(usdt)
            );
            StaticATokenMock aDAI = new StaticATokenMock(
                s.collateral[7].name,
                s.collateral[7].symbol,
                address(dai)
            );
            StaticATokenMock aUSDC = new StaticATokenMock(
                s.collateral[8].name,
                s.collateral[8].symbol,
                address(usdc)
            );
            StaticATokenMock aUSDT = new StaticATokenMock(
                s.collateral[9].name,
                s.collateral[9].symbol,
                address(usdt)
            );
            StaticATokenMock aBUSD = new StaticATokenMock(
                s.collateral[10].name,
                s.collateral[10].symbol,
                address(busd)
            );

            collateral[0] = _deployCollateral(
                ERC20Mock(address(dai)),
                AssetName.DAI,
                _ourAaveOracle
            );
            collateral[1] = _deployCollateral(
                ERC20Mock(address(usdc)),
                AssetName.USDC,
                _ourAaveOracle
            );
            collateral[2] = _deployCollateral(
                ERC20Mock(address(usdt)),
                AssetName.USDT,
                _ourAaveOracle
            );
            collateral[3] = _deployCollateral(
                ERC20Mock(address(busd)),
                AssetName.BUSD,
                _ourAaveOracle
            );
            collateral[4] = _deployCollateral(
                ERC20Mock(address(cDAI)),
                AssetName.cDAI,
                _ourCompoundOracle
            );
            collateral[5] = _deployCollateral(
                ERC20Mock(address(cUSDC)),
                AssetName.cUSDC,
                _ourCompoundOracle
            );
            collateral[6] = _deployCollateral(
                ERC20Mock(address(cUSDT)),
                AssetName.cUSDT,
                _ourCompoundOracle
            );
            collateral[7] = _deployCollateral(
                ERC20Mock(address(aDAI)),
                AssetName.aDAI,
                _ourAaveOracle
            );
            collateral[8] = _deployCollateral(
                ERC20Mock(address(aUSDC)),
                AssetName.aUSDC,
                _ourAaveOracle
            );
            collateral[9] = _deployCollateral(
                ERC20Mock(address(aUSDT)),
                AssetName.aUSDT,
                _ourAaveOracle
            );
            collateral[10] = _deployCollateral(
                ERC20Mock(address(aBUSD)),
                AssetName.aBUSD,
                _ourAaveOracle
            );

            _rsr = new ERC20Mock(s.rsr.name, s.rsr.symbol);
            _comp = new ERC20Mock(s.comp.name, s.comp.symbol);
            _aave = new ERC20Mock(s.aave.name, s.aave.symbol);

            _market = new MarketMock();
            _deployer = new DeployerExtension(
                _rsr,
                _comp,
                _aave,
                _market,
                _ourCompoundOracle,
                _ourAaveOracle
            );
            _setDefiCollateralRates(s.defiCollateralRates);
        }

        // Deploy Main/StRSR/RToken
        {
            // compute initial share from ProtoState
            RevenueShare memory initialShare;
            RevenueDistributorP0 throwawayDistributor = new RevenueDistributorP0(); // just for reading out constants
            for (uint256 i = 0; i < s.distribution.length; i++) {
                if (s.distribution[i].dest == throwawayDistributor.FURNACE()) {
                    initialShare.rTokenDist = s.distribution[i].rTokenDist;
                } else if (s.distribution[i].dest == throwawayDistributor.ST_RSR()) {
                    initialShare.rsrDist = s.distribution[i].rsrDist;
                }
            }

            _main = MainExtension(
                _deployer.deploy(
                    s.rToken.name,
                    s.rToken.symbol,
                    address(this),
                    s.config,
                    initialShare
                )
            );
            _stRSR = StRSRExtension(address(_main.stRSR()));
            _rToken = RTokenExtension(address(_main.rToken()));

            // add remaining distribution from ProtoState
            _main.connect(address(this));
            for (uint256 i = 0; i < s.distribution.length; i++) {
                if (
                    s.distribution[i].dest != throwawayDistributor.FURNACE() &&
                    s.distribution[i].dest == throwawayDistributor.ST_RSR()
                ) {
                    _main.setDistribution(
                        s.distribution[i].dest,
                        RevenueShare(s.distribution[i].rTokenDist, s.distribution[i].rsrDist)
                    );
                }
            }
        }

        // Initialize common assets
        {
            _assets[AssetName.RSR] = _main.rsrAsset();
            _assets[AssetName.COMP] = _main.compAsset();
            _assets[AssetName.AAVE] = _main.aaveAsset();
            _reverseAssets[_rsr] = AssetName.RSR;
            _reverseAssets[_comp] = AssetName.COMP;
            _reverseAssets[_aave] = AssetName.AAVE;
        }

        // Populate token ledgers + oracle prices
        {
            _initERC20(ERC20Mock(address(_rsr)), s.rsr);
            _initERC20(ERC20Mock(address(_comp)), s.comp);
            _initERC20(ERC20Mock(address(_aave)), s.aave);
            for (uint256 i = 0; i < s.collateral.length; i++) {
                _initERC20(ERC20Mock(address(collateral[i].erc20())), s.collateral[i]);
            }
            // StRSR.balance = RSR.mint + StRSR.stake
            for (uint256 i = 0; i < s.stRSR.balances.length; i++) {
                if (s.stRSR.balances[i] > 0) {
                    _rsr.mint(_address(i), s.stRSR.balances[i]);
                    _rsr.adminApprove(_address(i), address(_stRSR), s.stRSR.balances[i]);
                    _stRSR.connect(_address(i));
                    _stRSR.stake(s.stRSR.balances[i]);
                }
            }

            // Mint backing collateral and issue RToken
            for (uint256 i = 0; i < s.rToken.balances.length; i++) {
                if (s.rToken.balances[i] > 0) {
                    address[] memory tokens = _main.backingTokens();
                    uint256[] memory quantities = _main.quote(s.rToken.balances[i]);
                    for (uint256 j = 0; j < tokens.length; j++) {
                        ERC20Mock(tokens[j]).mint(_address(i), quantities[j]);
                        ERC20Mock(tokens[j]).adminApprove(
                            _address(i),
                            address(_main),
                            quantities[j]
                        );
                    }
                    _main.issueInstantly(_address(i), s.rToken.balances[i]);
                    assert(_main.rToken().balanceOf(_address(i)) == s.rToken.balances[i]);
                }
            }
        }

        // Set basket + unpause
        {
            ICollateral[] memory basketCollateral = new ICollateral[](s.bu_s[0].assets.length);
            for (uint256 i = 0; i < basketCollateral.length; i++) {
                basketCollateral[i] = collateral[uint256(s.bu_s[0].assets[i])];
            }
            _main.setPrimeBasket(basketCollateral, s.bu_s[0].refTargets);
            _main.unpause();
        }
    }

    function state() public view override returns (ProtoState memory s) {
        s.config = Config(
            _main.rewardStart(),
            _main.rewardPeriod(),
            _main.auctionPeriod(),
            _main.stRSRWithdrawalDelay(),
            _main.defaultDelay(),
            _main.maxTradeSlippage(),
            _main.maxAuctionSize(),
            _main.minRecapitalizationAuctionSize(),
            _main.minRevenueAuctionSize(),
            _main.migrationChunk(),
            _main.issuanceRate(),
            _main.defaultThreshold()
        );
        address[] memory backingTokens = _main.backingTokens();
        AssetName[] memory backingCollateral = new AssetName[](backingTokens.length);
        for (uint256 i = 0; i < backingTokens.length; i++) {
            backingCollateral[i] = _reverseAssets[ERC20Mock(backingTokens[i])];
        }
        s.distribution = _main.STATE_revenueDistribution();
        s.rTokenDefinition = BU(backingCollateral, _main.basketRefTargets());
        s.rToken = _dumpERC20(_main.rToken());
        s.rsr = _dumpERC20(_main.rsr());
        s.stRSR = _dumpERC20(_main.stRSR());
        s.bu_s = _traverseVaults();
        s.comp = _dumpERC20(_main.compAsset().erc20());
        s.aave = _dumpERC20(_main.aaveAsset().erc20());
        s.collateral = new TokenState[](NUM_COLLATERAL);
        for (uint256 i = 0; i < NUM_COLLATERAL; i++) {
            s.collateral[i] = _dumpERC20(_assets[AssetName(i)].erc20());
        }
        s.defiCollateralRates = new Fix[](NUM_COLLATERAL);
        s.defiCollateralRates[uint256(AssetName.DAI)] = FIX_ZERO;
        s.defiCollateralRates[uint256(AssetName.USDC)] = FIX_ZERO;
        s.defiCollateralRates[uint256(AssetName.USDT)] = FIX_ZERO;
        s.defiCollateralRates[uint256(AssetName.BUSD)] = FIX_ZERO;
        for (uint256 i = NUM_FIATCOINS; i < NUM_COLLATERAL; i++) {
            s.defiCollateralRates[i] = _rateToUnderlying(address(_assets[AssetName(i)]));
        }
        s.ethPrice = Price(
            _aaveOracle.getAssetPrice(_aaveOracle.WETH()),
            _compoundOracle.price(ETH)
        );
    }

    function matches(ProtoState memory s) external view override returns (bool) {
        return state().assertEq(s);
    }

    function assertInvariants() external view override {
        _deployer.assertInvariants();
        _main.assertInvariants();
        _rToken.assertInvariants();
        _stRSR.assertInvariants();
    }

    /// @param baseAssets One-of DAI/USDC/USDT/BUSD/RSR/COMP/AAVE
    function setBaseAssetPrices(AssetName[] memory baseAssets, Price[] memory prices)
        external
        override
    {
        for (uint256 i = 0; i < baseAssets.length; i++) {
            _aaveOracle.setPrice(address(_assets[baseAssets[i]].erc20()), prices[i].inETH);
            _compoundOracle.setPrice(
                IERC20Metadata(address(_assets[baseAssets[i]].erc20())).symbol(),
                prices[i].inUSD
            );
        }
    }

    /// @param defiCollateral CTokens and ATokens, not necessarily of length 11
    function setDefiCollateralRates(
        AssetName[] memory defiCollateral,
        Fix[] memory fiatcoinRedemptionRates
    ) external override {
        Fix[] memory rates = new Fix[](NUM_COLLATERAL);
        for (uint256 i = NUM_FIATCOINS; i < NUM_COLLATERAL; i++) {
            rates[i] = _rateToUnderlying(address(_assets[AssetName(i)]));
        }
        for (uint256 i = 0; i < defiCollateral.length; i++) {
            require(
                uint256(defiCollateral[i]) >= NUM_FIATCOINS,
                "cannot set defi rate for fiatcoin"
            );
            rates[uint256(defiCollateral[i])] = fiatcoinRedemptionRates[i];
        }
        _setDefiCollateralRates(rates);
    }

    // === COMMANDS ====

    function CMD_issue(Account account, uint256 amount) external override {
        _main.connect(_address(uint256(account)));
        address[] memory tokens = _main.backingTokens();
        uint256[] memory quantities = _main.quote(amount);
        for (uint256 i = 0; i < tokens.length; i++) {
            ERC20Mock(tokens[i]).adminApprove(
                _address(uint256(account)),
                address(_main),
                quantities[i]
            );
        }
        _main.issue(amount);
    }

    function CMD_redeem(Account account, uint256 amount) external override {
        _main.connect(_address(uint256(account)));
        _main.redeem(amount);
    }

    function CMD_poke() external virtual override {
        _main.poke();
        _fillAuctions();
    }

    function CMD_stakeRSR(Account account, uint256 amount) external override {
        _rsr.adminApprove(_address(uint256(account)), address(_stRSR), amount);
        _stRSR.connect(_address(uint256(account)));
        _stRSR.stake(amount);
    }

    function CMD_unstakeRSR(Account account, uint256 amount) external override {
        _stRSR.connect(_address(uint256(account)));
        _stRSR.unstake(amount);
    }

    function CMD_setRTokenForMelting(uint256 amount) external override {}

    function CMD_transferRToken(
        Account from,
        Account,
        uint256
    ) external override {
        _rToken.connect(_address(uint256(from)));
    }

    function CMD_transferStRSR(
        Account from,
        Account,
        uint256
    ) external override {
        _stRSR.connect(_address(uint256(from)));
    }

    // =================================================================

    /// @param rates {fiatTok/tok} A Fix for every collateral. indices 0-3 are ignored for fiatcoins
    function _setDefiCollateralRates(Fix[] memory rates) internal {
        for (uint256 i = NUM_FIATCOINS; i < rates.length; i++) {
            // StaticATokenMock also has `setExchangeRate(Fix)`
            CTokenMock(address(_assets[AssetName(i)].erc20())).setExchangeRate(rates[i]);
        }
    }

    /// @return {fiatTok/tok}
    function _rateToUnderlying(address lendingCollateral) internal view returns (Fix) {
        return CTokenCollateralP0(lendingCollateral).referencePrice();
    }

    /// @param token The ERC20 token
    function _dumpERC20(IERC20 token) internal view returns (TokenState memory tokenState) {
        IERC20Metadata erc20 = IERC20Metadata(address(token));
        tokenState.name = erc20.name();
        tokenState.symbol = erc20.symbol();
        tokenState.balances = new uint256[](uint256(type(Account).max) + 1);
        for (uint256 i = 0; i < uint256(type(Account).max) + 1; i++) {
            tokenState.balances[i] = erc20.balanceOf(_address(i));
        }
        tokenState.totalSupply = erc20.totalSupply();
        tokenState.price = Price(
            _aaveOracle.getAssetPrice(address(erc20)),
            _compoundOracle.price(erc20.symbol())
        );
    }

    /// Deploys Collateral contracts and sets up initial balances
    function _deployCollateral(
        ERC20Mock erc20,
        AssetName collateralAsset,
        IOracle oracle
    ) internal returns (ICollateral) {
        string memory c = "c";
        string memory a = "a";
        if (erc20.symbol().toSlice().startsWith(c.toSlice())) {
            ICollateral underlying = ICollateral(
                address(_assets[_reverseAssets[ERC20Mock(CTokenMock(address(erc20)).underlying())]])
            );
            _assets[collateralAsset] = new CTokenCollateralP0(
                erc20,
                underlying.erc20(),
                _main,
                underlying.oracle(),
                bytes32(bytes(erc20.symbol()))
            );
        } else if (erc20.symbol().toSlice().startsWith(a.toSlice())) {
            ICollateral underlying = ICollateral(
                address(
                    _assets[
                        _reverseAssets[
                            ERC20Mock(
                                StaticATokenMock(address(erc20)).ATOKEN().UNDERLYING_ASSET_ADDRESS()
                            )
                        ]
                    ]
                )
            );
            _assets[collateralAsset] = new ATokenCollateralP0(
                erc20,
                underlying.erc20(),
                _main,
                underlying.oracle(),
                bytes32(bytes(erc20.symbol()))
            );
        } else {
            _assets[collateralAsset] = new CollateralP0(
                erc20,
                erc20,
                _main,
                oracle,
                bytes32(bytes(erc20.symbol()))
            );
        }
        _reverseAssets[ERC20Mock(address(_assets[collateralAsset].erc20()))] = collateralAsset;
        return ICollateral(address(_assets[collateralAsset]));
    }

    /// Populates balances + oracle prices
    function _initERC20(ERC20Mock erc20, TokenState memory tokenState) internal {
        assert(keccak256(bytes(erc20.symbol())) == keccak256(bytes(tokenState.symbol)));
        // Prices
        for (uint256 i = 0; i < tokenState.balances.length; i++) {
            if (tokenState.balances[i] > 0) {
                erc20.mint(_address(i), tokenState.balances[i]);
            }
        }
        assert(erc20.totalSupply() == tokenState.totalSupply);

        // Oracle price information
        AssetName asset = _reverseAssets[erc20];
        if (uint256(asset) < NUM_FIATCOINS || uint256(asset) >= NUM_COLLATERAL) {
            _aaveOracle.setPrice(address(erc20), tokenState.price.inETH); // {qETH/tok}
            _compoundOracle.setPrice(erc20.symbol(), tokenState.price.inUSD); // {microUSD/tok}

            Fix found = _assets[asset].price(); // {attoUSD/tok}
            Fix expected = toFix(tokenState.price.inUSD);
            assert(found.eq(expected));
        }
    }

    /// Uses Account.TRADER as auction counterparty for all auctions
    function _fillAuctions() internal {
        uint256 numAuctions = _market.numAuctions();
        for (uint256 i = 0; i < numAuctions; i++) {
            (, IERC20 sell, IERC20 buy, uint256 sellAmount, , , , AuctionStatus state_) = _market
            .auctions(i);
            (address bidder, , ) = _market.bids(i);
            if (state_ == AuctionStatus.OPEN && bidder == address(0)) {
                Bid memory newBid;
                newBid.bidder = _address(uint256(Account.TRADER));
                newBid.sellAmount = sellAmount;
                IAsset sellAsset = _assets[_reverseAssets[ERC20Mock(address(sell))]];
                IAsset buyAsset = _assets[_reverseAssets[ERC20Mock(address(buy))]];
                newBid.buyAmount = toFix(sellAmount)
                .mul(buyAsset.price())
                .div(sellAsset.price())
                .ceil();
                ERC20Mock(address(buy)).mint(newBid.bidder, newBid.buyAmount);
                ERC20Mock(address(buy)).adminApprove(
                    newBid.bidder,
                    address(_market),
                    newBid.buyAmount
                );
                _market.placeBid(i, newBid);
            }
        }
    }

    /// @return bu_s The Basket Units of the stick DAG
    function _traverseVaults() internal view returns (BU[] memory bu_s) {
        address[] memory tokens = _main.backingTokens();
        AssetName[] memory assets = new AssetName[](tokens.length);
        for (uint256 i = 0; i < assets.length; i++) {
            assets[i] = _reverseAssets[ERC20Mock(address(tokens[i]))];
        }

        bu_s = new BU[](1);
        bu_s[0] = BU(assets, _main.basketRefTargets());
    }

    /// Account index -> address
    function _address(uint256 index) internal view returns (address) {
        if (index == uint256(Account.RTOKEN)) {
            return address(_rToken);
        } else if (index == uint256(Account.STRSR)) {
            return address(_stRSR);
        } else if (index == uint256(Account.MAIN)) {
            return address(_main);
        }

        // EOA: Use 0x1, 0x2, ...
        return address((uint160(index) + 1));
    }
}
