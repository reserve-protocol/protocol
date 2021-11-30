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
import "contracts/p0/assets/collateral/ATokenCollateralP0.sol";
import "contracts/p0/assets/collateral/CollateralP0.sol";
import "contracts/p0/assets/collateral/CTokenCollateralP0.sol";
import "contracts/p0/interfaces/IAsset.sol";
import "contracts/p0/interfaces/IDeployer.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/interfaces/IRToken.sol";
import "contracts/p0/interfaces/IStRSR.sol";
import "contracts/p0/interfaces/IVault.sol";
import "contracts/p0/libraries/Oracle.sol";
import "contracts/p0/mocks/AaveLendingPoolMockP0.sol";
import "contracts/p0/mocks/AaveLendingAddrProviderMockP0.sol";
import "contracts/p0/mocks/AaveOracleMockP0.sol";
import "contracts/p0/mocks/CompoundOracleMockP0.sol";
import "contracts/p0/mocks/ComptrollerMockP0.sol";
import "contracts/p0/mocks/RTokenMockP0.sol";
import "contracts/p0/VaultP0.sol";
import "contracts/test/Lib.sol";
import "contracts/test/ProtosDriver.sol";
import "contracts/test/ProtoState.sol";

import "./DeployerExtension.sol";
import "./MainExtension.sol";
import "./RTokenExtension.sol";
import "./StRSRExtension.sol";

import "hardhat/console.sol";

contract AdapterP0 is ProtoAdapter {
    using Oracle for Oracle.Info;
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

    // Oracles
    CompoundOracleMockP0 internal _compoundOracle;
    AaveOracleMockP0 internal _aaveOracle;

    // Collateral
    mapping(Asset => IAsset) internal _assets;
    mapping(ERC20Mock => Asset) internal _reverseAssets;

    function init(ProtoState memory s) external override {
        // Deploy assets + deployer
        ICollateral[] memory collateral = new ICollateral[](NUM_COLLATERAL);
        {
            ERC20Mock dai = new ERC20Mock(s.collateral[0].name, s.collateral[0].symbol);
            USDCMock usdc = new USDCMock(s.collateral[1].name, s.collateral[1].symbol);
            ERC20Mock usdt = new ERC20Mock(s.collateral[2].name, s.collateral[2].symbol);
            ERC20Mock busd = new ERC20Mock(s.collateral[3].name, s.collateral[3].symbol);
            CTokenMock cDAI = new CTokenMock(s.collateral[4].name, s.collateral[4].symbol, address(dai));
            CTokenMock cUSDC = new CTokenMock(s.collateral[5].name, s.collateral[5].symbol, address(usdc));
            CTokenMock cUSDT = new CTokenMock(s.collateral[6].name, s.collateral[6].symbol, address(usdt));
            StaticATokenMock aDAI = new StaticATokenMock(s.collateral[7].name, s.collateral[7].symbol, address(dai));
            StaticATokenMock aUSDC = new StaticATokenMock(s.collateral[8].name, s.collateral[8].symbol, address(usdc));
            StaticATokenMock aUSDT = new StaticATokenMock(s.collateral[9].name, s.collateral[9].symbol, address(usdt));
            StaticATokenMock aBUSD = new StaticATokenMock(
                s.collateral[10].name,
                s.collateral[10].symbol,
                address(busd)
            );
            _rsr = new ERC20Mock(s.rsr.name, s.rsr.symbol);
            _comp = new ERC20Mock(s.comp.name, s.comp.symbol);
            _aave = new ERC20Mock(s.aave.name, s.aave.symbol);

            collateral[0] = _deployCollateral(ERC20Mock(address(dai)), Asset.DAI);
            collateral[1] = _deployCollateral(ERC20Mock(address(usdc)), Asset.USDC);
            collateral[2] = _deployCollateral(ERC20Mock(address(usdt)), Asset.USDT);
            collateral[3] = _deployCollateral(ERC20Mock(address(busd)), Asset.BUSD);
            collateral[4] = _deployCollateral(ERC20Mock(address(cDAI)), Asset.cDAI);
            collateral[5] = _deployCollateral(ERC20Mock(address(cUSDC)), Asset.cUSDC);
            collateral[6] = _deployCollateral(ERC20Mock(address(cUSDT)), Asset.cUSDT);
            collateral[7] = _deployCollateral(ERC20Mock(address(aDAI)), Asset.aDAI);
            collateral[8] = _deployCollateral(ERC20Mock(address(aUSDC)), Asset.aUSDC);
            collateral[9] = _deployCollateral(ERC20Mock(address(aUSDT)), Asset.aUSDT);
            collateral[10] = _deployCollateral(ERC20Mock(address(aBUSD)), Asset.aBUSD);

            _assets[Asset.RSR] = new RSRAssetP0(address(_rsr));
            _assets[Asset.COMP] = new COMPAssetP0(address(_comp));
            _assets[Asset.AAVE] = new AAVEAssetP0(address(_aave));
            _reverseAssets[_rsr] = Asset.RSR;
            _reverseAssets[_comp] = Asset.COMP;
            _reverseAssets[_aave] = Asset.AAVE;

            _market = new MarketMock();
            _deployer = new DeployerExtension(_assets[Asset.RSR], _assets[Asset.COMP], _assets[Asset.AAVE], _market);
            _setDefiCollateralRates(s.defiCollateralRates);
        }

        // Deploy vault for each basket
        IVault[] memory vaults = new IVault[](s.bu_s.length);
        {
            for (int256 i = int256(s.bu_s.length) - 1; i >= 0; i--) {
                uint256 iUint = uint256(i);
                IVault[] memory prevVaults = new IVault[](s.bu_s.length - 1 - iUint);
                for (uint256 j = iUint + 1; j < s.bu_s.length; j++) {
                    prevVaults[j - (iUint + 1)] = vaults[j];
                }

                ICollateral[] memory backing = new ICollateral[](s.bu_s[iUint].assets.length);
                for (uint256 j = 0; j < s.bu_s[iUint].assets.length; j++) {
                    backing[j] = collateral[uint256(s.bu_s[iUint].assets[j])];
                }

                vaults[iUint] = new VaultP0(backing, s.bu_s[iUint].quantities, prevVaults);
            }
        }

        // Deploy oracles + Main/StRSR/RToken
        {
            _compoundOracle = new CompoundOracleMockP0();
            _compoundOracle.setPrice(ETH, s.ethPrice.inUSD);
            IComptroller comptroller = new ComptrollerMockP0(address(_compoundOracle));
            _aaveOracle = new AaveOracleMockP0(address(new ERC20Mock("Wrapped ETH", "WETH")));
            _aaveOracle.setPrice(_aaveOracle.WETH(), s.ethPrice.inETH);
            IAaveLendingPool aaveLendingPool = new AaveLendingPoolMockP0(
                address(new AaveLendingAddrProviderMockP0(address(_aaveOracle)))
            );

            _main = MainExtension(
                _deployer.deploy(
                    s.rToken.name,
                    s.rToken.symbol,
                    address(this),
                    vaults[0],
                    s.config,
                    comptroller,
                    aaveLendingPool,
                    collateral
                )
            );
            _stRSR = StRSRExtension(address(_main.stRSR()));
            _rToken = RTokenExtension(address(_main.rToken()));

            for (uint256 i = 0; i < vaults.length; i++) {
                vaults[i].setMain(address(_main));
            }
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
                        ERC20Mock(tokens[j]).adminApprove(_address(i), address(_main), quantities[j]);
                    }
                    _main.issueInstantly(_address(i), s.rToken.balances[i]);
                    assert(_main.rToken().balanceOf(_address(i)) == s.rToken.balances[i]);
                }
            }
        }
    }

    function state() public view override returns (ProtoState memory s) {
        s.mood = _main.mood();
        s.config = _main.config();
        address[] memory backingTokens = _main.backingTokens();
        Asset[] memory backingCollateral = new Asset[](backingTokens.length);
        for (uint256 i = 0; i < backingTokens.length; i++) {
            backingCollateral[i] = _reverseAssets[ERC20Mock(backingTokens[i])];
        }
        s.rTokenDefinition = BU(backingCollateral, _main.quote(10**_main.rToken().decimals()));
        s.rToken = _dumpERC20(_main.rToken());
        s.rsr = _dumpERC20(_main.rsr());
        s.stRSR = _dumpERC20(_main.stRSR());
        s.bu_s = _traverseVaults();
        s.comp = _dumpERC20(_main.compAsset().erc20());
        s.aave = _dumpERC20(_main.aaveAsset().erc20());
        s.collateral = new TokenState[](NUM_COLLATERAL);
        for (uint256 i = 0; i < NUM_COLLATERAL; i++) {
            s.collateral[i] = _dumpERC20(_assets[Asset(i)].erc20());
        }
        s.defiCollateralRates = new Fix[](NUM_COLLATERAL);
        s.defiCollateralRates[uint256(Asset.DAI)] = FIX_ZERO;
        s.defiCollateralRates[uint256(Asset.USDC)] = FIX_ZERO;
        s.defiCollateralRates[uint256(Asset.USDT)] = FIX_ZERO;
        s.defiCollateralRates[uint256(Asset.BUSD)] = FIX_ZERO;
        for (uint256 i = NUM_FIATCOINS; i < NUM_COLLATERAL; i++) {
            s.defiCollateralRates[i] = _dumpDefiCollateralRate(ICollateral(address(_assets[Asset(i)])));
        }
        s.ethPrice = OraclePrice(_aaveOracle.getAssetPrice(_aaveOracle.WETH()), _compoundOracle.price(ETH));
    }

    function matches(ProtoState memory s) external view override returns (bool) {
        return state().assertEq(s);
    }

    function assertInvariants() external override {
        _deployer.assertInvariants();
        _main.assertInvariants();
        _rToken.assertInvariants();
        _stRSR.assertInvariants();
    }

    /// @param baseAssets One-of DAI/USDC/USDT/BUSD/RSR/COMP/AAVE
    function setBaseAssetPrices(Asset[] memory baseAssets, OraclePrice[] memory prices) external override {
        for (uint256 i = 0; i < baseAssets.length; i++) {
            _aaveOracle.setPrice(address(_assets[baseAssets[i]].erc20()), prices[i].inETH);
            _compoundOracle.setPrice(IERC20Metadata(address(_assets[baseAssets[i]].erc20())).symbol(), prices[i].inUSD);
        }
    }

    /// @param defiCollateral CTokens and ATokens, not necessarily of length 11
    function setDefiCollateralRates(Asset[] memory defiCollateral, Fix[] memory fiatcoinRedemptionRates)
        external
        override
    {
        Fix[] memory rates = new Fix[](NUM_COLLATERAL);
        for (uint256 i = NUM_FIATCOINS; i < NUM_COLLATERAL; i++) {
            rates[i] = _dumpDefiCollateralRate(ICollateral(address(_assets[Asset(i)])));
        }
        for (uint256 i = 0; i < defiCollateral.length; i++) {
            require(uint256(defiCollateral[i]) >= NUM_FIATCOINS, "cannot set defi rate for fiatcoin");
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
            ERC20Mock(tokens[i]).adminApprove(_address(uint256(account)), address(_main), quantities[i]);
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
        Account to,
        uint256 amount
    ) external override {
        _rToken.connect(_address(uint256(from)));
    }

    function CMD_transferStRSR(
        Account from,
        Account to,
        uint256 amount
    ) external override {
        _stRSR.connect(_address(uint256(from)));
    }

    // =================================================================

    /// @param rates {fiatTok/tok} A Fix for every collateral. indices 0-3 are ignored for fiatcoins
    function _setDefiCollateralRates(Fix[] memory rates) internal {
        for (uint256 i = NUM_FIATCOINS; i < rates.length; i++) {
            // StaticATokenMock also has `setExchangeRate(Fix)`
            CTokenMock(address(_assets[Asset(i)].erc20())).setExchangeRate(rates[i]);
        }
    }

    /// @return {fiatTok/tok}
    function _dumpDefiCollateralRate(ICollateral collateral) internal view returns (Fix) {
        // {fiatTok/tok} = {qFiatTok/qTok} * {qTok/tok} / {qFiatTok/fiatTok}
        int8 shiftLeft = int8(collateral.decimals()) - int8(collateral.fiatcoinDecimals());
        return collateral.rateFiatcoin().shiftLeft(shiftLeft);
    }

    /// @param token The ERC20 token
    function _dumpERC20(IERC20 token) internal view returns (TokenState memory tokenState) {
        IERC20Metadata erc20 = IERC20Metadata(address(token));
        tokenState.name = erc20.name();
        tokenState.symbol = erc20.symbol();
        tokenState.balances = new uint256[](uint256(type(Account).max) + 1);
        tokenState.allowances = new uint256[][](uint256(type(Account).max) + 1);
        for (uint256 i = 0; i < uint256(type(Account).max) + 1; i++) {
            tokenState.balances[i] = erc20.balanceOf(_address(i));
            tokenState.allowances[i] = new uint256[](uint256(type(Account).max) + 1);
            for (uint256 j = 0; j < uint256(type(Account).max) + 1; j++) {
                tokenState.allowances[i][j] = erc20.allowance(_address(i), _address(j));
            }
        }
        tokenState.totalSupply = erc20.totalSupply();
        tokenState.price = OraclePrice(
            _aaveOracle.getAssetPrice(address(erc20)),
            _compoundOracle.price(erc20.symbol())
        );
    }

    /// Deploys Collateral contracts and sets up initial balances / allowances
    function _deployCollateral(ERC20Mock erc20, Asset collateralAsset) internal returns (ICollateral) {
        string memory c = "c";
        string memory a = "a";
        if (erc20.symbol().toSlice().startsWith(c.toSlice())) {
            _assets[collateralAsset] = new CTokenCollateralP0(address(erc20));
        } else if (erc20.symbol().toSlice().startsWith(a.toSlice())) {
            _assets[collateralAsset] = new ATokenCollateralP0(address(erc20));
        } else {
            _assets[collateralAsset] = new CollateralP0(address(erc20));
        }
        _reverseAssets[ERC20Mock(address(_assets[collateralAsset].erc20()))] = collateralAsset;
        return ICollateral(address(_assets[collateralAsset]));
    }

    /// Populates balances + allowances + oracle prices
    function _initERC20(ERC20Mock erc20, TokenState memory tokenState) internal {
        assert(keccak256(bytes(erc20.symbol())) == keccak256(bytes(tokenState.symbol)));
        // Balances
        for (uint256 i = 0; i < tokenState.balances.length; i++) {
            if (tokenState.balances[i] > 0) {
                erc20.mint(_address(i), tokenState.balances[i]);
            }
        }
        assert(erc20.totalSupply() == tokenState.totalSupply);

        // Allowances
        for (uint256 i = 0; i < tokenState.allowances.length; i++) {
            for (uint256 j = 0; j < tokenState.allowances[i].length; j++) {
                if (tokenState.allowances[i][j] > 0) {
                    erc20.adminApprove(_address(i), _address(j), tokenState.allowances[i][j]);
                }
            }
        }

        // Oracle price information
        Asset asset = _reverseAssets[erc20];
        if (uint256(asset) < NUM_FIATCOINS || uint256(asset) >= NUM_COLLATERAL) {
            _aaveOracle.setPrice(address(erc20), tokenState.price.inETH); // {qETH/tok}
            _compoundOracle.setPrice(erc20.symbol(), tokenState.price.inUSD); // {microUSD/tok}

            Fix found = _main.consultOracle(Oracle.Source.AAVE, address(erc20)); // {attoUSD/qTok}
            Fix expected = toFix(tokenState.price.inUSD).shiftLeft(12 - int8(erc20.decimals()));
            assert(found.eq(expected));
        }
    }

    /// Uses Account.TRADER as auction counterparty for all auctions
    function _fillAuctions() internal {
        uint256 numAuctions = _market.numAuctions();
        for (uint256 i = 0; i < numAuctions; i++) {
            (, IERC20 sell, IERC20 buy, uint256 sellAmount, , , , bool isOpen) = _market.auctions(i);
            (address bidder, , uint256 buyAmount) = _market.bids(i);
            if (isOpen && bidder == address(0)) {
                Bid memory newBid;
                newBid.bidder = _address(uint256(Account.TRADER));
                newBid.sellAmount = sellAmount;
                IAsset sellAsset = _assets[_reverseAssets[ERC20Mock(address(sell))]];
                IAsset buyAsset = _assets[_reverseAssets[ERC20Mock(address(buy))]];
                newBid.buyAmount = toFix(sellAmount)
                .mul(buyAsset.priceUSD(address(_main)))
                .div(sellAsset.priceUSD(address(_main)))
                .toUint();
                ERC20Mock(address(buy)).mint(newBid.bidder, newBid.buyAmount);
                ERC20Mock(address(buy)).adminApprove(newBid.bidder, address(_market), newBid.buyAmount);
                _market.placeBid(i, newBid);
            }
        }
    }

    /// @return bu_s The Basket Units of the stick DAG
    function _traverseVaults() internal view returns (BU[] memory bu_s) {
        IVault v = _main.vault();
        Asset[] memory collateral;
        IVault[] memory backups;
        do {
            backups = v.getBackups();
            BU[] memory next = new BU[](bu_s.length + 1);
            for (uint256 i = 0; i < bu_s.length; i++) {
                next[i] = bu_s[i];
            }
            collateral = new Asset[](v.size());
            for (uint256 i = 0; i < v.size(); i++) {
                collateral[i] = _reverseAssets[ERC20Mock(address(v.collateralAt(i).erc20()))];
            }
            next[bu_s.length] = BU(collateral, v.tokenAmounts(10**v.BU_DECIMALS()));
            bu_s = next;
            if (backups.length > 0) {
                v = backups[0]; // walk the DAG
            }
        } while (backups.length > 0);
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
