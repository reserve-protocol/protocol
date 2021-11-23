// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/libraries/test/strings.sol";
import "contracts/mocks/ATokenMock.sol";
import "contracts/mocks/CTokenMock.sol";
import "contracts/mocks/ERC20Mock.sol";
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

interface IMockERC20 is IERC20Metadata {
    function mint(address recipient, uint256 amount) external;

    function setAllowance(
        address owner,
        address spender,
        uint256 amount
    ) external;
}

contract AdapterP0 is ProtoAdapter {
    using Lib for ProtoState;
    using strings for string;
    using strings for strings.slice;

    string constant ETH = "ETH";

    // Deployed system contracts
    DeployerExtension internal _deployer;
    IMockERC20 internal _rsr;
    IMockERC20 internal _comp;
    IMockERC20 internal _aave;
    MainExtension internal _main;
    StRSRExtension internal _stRSR;
    RTokenExtension internal _rToken;

    // Oracles
    CompoundOracleMockP0 internal _compoundOracle;
    AaveOracleMockP0 internal _aaveOracle;

    // Collateral
    mapping(CollateralToken => ICollateral) internal _collateral;
    mapping(IERC20 => CollateralToken) internal _reverseCollateral; // by the ERC20 of the collateral

    function init(ProtoState memory s) external override {
        // Deploy deployer factory
        {
            _rsr = IMockERC20(address(new ERC20Mock(s.rsr.name, s.rsr.symbol)));
            _comp = IMockERC20(address(new ERC20Mock(s.comp.name, s.comp.symbol)));
            _aave = IMockERC20(address(new ERC20Mock(s.aave.name, s.aave.symbol)));
            IAsset rsrAsset = new RSRAssetP0(address(_rsr));
            IAsset compAsset = new COMPAssetP0(address(_comp));
            IAsset aaveAsset = new AAVEAssetP0(address(_aave));
            _deployer = new DeployerExtension(rsrAsset, compAsset, aaveAsset);
        }

        // Deploy collateral assets
        ICollateral[] memory collateral = new ICollateral[](uint256(type(CollateralToken).max) + 1);
        {
            ERC20Mock dai = new ERC20Mock(s.collateral[0].name, s.collateral[0].symbol);
            USDCMock usdc = new USDCMock(s.collateral[1].name, s.collateral[1].symbol);
            ERC20Mock usdt = new ERC20Mock(s.collateral[2].name, s.collateral[2].symbol);
            ERC20Mock busd = new ERC20Mock(s.collateral[3].name, s.collateral[3].symbol);
            CTokenMock cDAI = new CTokenMock(s.collateral[4].name, s.collateral[4].symbol, address(dai));
            CTokenMock cUSDC = new CTokenMock(s.collateral[5].name, s.collateral[5].symbol, address(usdc));
            CTokenMock cUSDT = new CTokenMock(s.collateral[6].name, s.collateral[6].symbol, address(usdt));
            ATokenMock aDAI = new ATokenMock(s.collateral[7].name, s.collateral[7].symbol, address(dai));
            ATokenMock aUSDC = new ATokenMock(s.collateral[8].name, s.collateral[8].symbol, address(usdc));
            ATokenMock aUSDT = new ATokenMock(s.collateral[9].name, s.collateral[9].symbol, address(usdt));
            ATokenMock aBUSD = new ATokenMock(s.collateral[10].name, s.collateral[10].symbol, address(busd));

            collateral[0] = _deployCollateral(IMockERC20(address(dai)), CollateralToken.DAI);
            collateral[1] = _deployCollateral(IMockERC20(address(usdc)), CollateralToken.USDC);
            collateral[2] = _deployCollateral(IMockERC20(address(usdt)), CollateralToken.USDT);
            collateral[3] = _deployCollateral(IMockERC20(address(busd)), CollateralToken.BUSD);
            collateral[4] = _deployCollateral(IMockERC20(address(cDAI)), CollateralToken.cDAI);
            collateral[5] = _deployCollateral(IMockERC20(address(cUSDC)), CollateralToken.cUSDC);
            collateral[6] = _deployCollateral(IMockERC20(address(cUSDT)), CollateralToken.cUSDT);
            collateral[7] = _deployCollateral(IMockERC20(address(aDAI)), CollateralToken.aDAI);
            collateral[8] = _deployCollateral(IMockERC20(address(aUSDC)), CollateralToken.aUSDC);
            collateral[9] = _deployCollateral(IMockERC20(address(aUSDT)), CollateralToken.aUSDT);
            collateral[10] = _deployCollateral(IMockERC20(address(aBUSD)), CollateralToken.aBUSD);
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

                ICollateral[] memory backing = new ICollateral[](s.bu_s[iUint].tokens.length);
                for (uint256 j = 0; j < s.bu_s[iUint].tokens.length; j++) {
                    backing[j] = _collateral[s.bu_s[iUint].tokens[j]];
                }

                vaults[iUint] = new VaultP0(backing, s.bu_s[iUint].quantities, prevVaults);
            }
        }

        // Deploy rest of system
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
        }

        for (uint256 i = 0; i < vaults.length; i++) {
            vaults[i].setMain(_main);
        }

        // Populate token ledgers + oracle prices
        {
            for (uint256 i = 0; i < uint256(type(CollateralToken).max) + 1; i++) {
                _initERC20(IMockERC20(address(collateral[i].erc20())), s.collateral[i]);
            }
            for (uint256 i = 0; i < s.stRSR.balances.length; i++) {
                // Mint stRSR to RSR initially, then stake
                if (s.stRSR.balances[i] > 0) {
                    _rsr.mint(_address(i), s.stRSR.balances[i]);
                    _stRSR.connect(_address(i));
                    _stRSR.stake(s.stRSR.balances[i]);
                }
            }
            for (uint256 i = 0; i < s.rToken.balances.length; i++) {
                if (s.rToken.balances[i] > 0) {
                    _rToken.adminMint(_address(i), s.rToken.balances[i]);
                }
            }

            _aaveOracle.setPrice(address(_stRSR), s.stRSR.price.inETH);
            _compoundOracle.setPrice(IERC20Metadata(address(_stRSR)).symbol(), s.stRSR.price.inUSD);
            _aaveOracle.setPrice(address(_rToken), s.rToken.price.inETH);
            _compoundOracle.setPrice(IERC20Metadata(address(_rToken)).symbol(), s.rToken.price.inUSD);

            _initERC20(IMockERC20(address(_rsr)), s.rsr);
            _initERC20(IMockERC20(address(_comp)), s.comp);
            _initERC20(IMockERC20(address(_aave)), s.aave);
        }
    }

    function state() public view override returns (ProtoState memory s) {
        s.config = _main.config();
        address[] memory backingTokens = _main.backingTokens();
        CollateralToken[] memory backingCollateral = new CollateralToken[](backingTokens.length);
        for (uint256 i = 0; i < backingTokens.length; i++) {
            backingCollateral[i] = _reverseCollateral[IERC20(backingTokens[i])];
        }
        s.rTokenDefinition = BU(backingCollateral, _main.quote(10**_main.rToken().decimals()));
        s.rToken = _dumpERC20(_main.rToken());
        s.rsr = _dumpERC20(_main.rsr());
        s.stRSR = _dumpERC20(_main.stRSR());
        s.bu_s = _traverseVaults();
        s.comp = _dumpERC20(_main.compAsset().erc20());
        s.aave = _dumpERC20(_main.aaveAsset().erc20());
        s.collateral = new TokenState[](uint256(type(CollateralToken).max) + 1);
        for (uint256 i = 0; i < uint256(type(CollateralToken).max) + 1; i++) {
            s.collateral[i] = _dumpERC20(_collateral[CollateralToken(i)].erc20());
        }
        s.ethPrice = OraclePrice(_aaveOracle.getAssetPrice(_aaveOracle.WETH()), _compoundOracle.price(ETH));
    }

    function matches(ProtoState memory s) external view override returns (bool) {
        return state().eq(s);
    }

    function checkInvariants() external override returns (bool) {
        return
            _deployer.checkInvariants() &&
            _main.checkInvariants() &&
            _rToken.checkInvariants() &&
            _stRSR.checkInvariants();
    }

    // === COMMANDS ====

    function CMD_issue(Account account, uint256 amount) external override {
        _main.connect(_address(uint256(account)));
        _main.issue(amount);
    }

    function CMD_redeem(Account account, uint256 amount) external override {
        _main.connect(_address(uint256(account)));
        _main.redeem(amount);
    }

    function CMD_checkForDefault() external override {
        _main.noticeDefault();
    }

    function CMD_poke() external override {
        _main.poke();
    }

    function CMD_stakeRSR(Account account, uint256 amount) external override {
        _stRSR.connect(_address(uint256(account)));
    }

    function CMD_unstakeRSR(Account account, uint256 amount) external override {
        _stRSR.connect(_address(uint256(account)));
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
    function _deployCollateral(IMockERC20 erc20, CollateralToken ct) internal returns (ICollateral) {
        string memory c = "c";
        string memory a = "a";
        if (erc20.symbol().toSlice().startsWith(c.toSlice())) {
            _collateral[ct] = new CTokenCollateralP0(address(erc20));
        } else if (erc20.symbol().toSlice().startsWith(a.toSlice())) {
            _collateral[ct] = new ATokenCollateralP0(address(erc20));
        } else {
            _collateral[ct] = new CollateralP0(address(erc20));
        }
        _reverseCollateral[_collateral[ct].erc20()] = ct;
        return _collateral[ct];
    }

    function _initERC20(IMockERC20 erc20, TokenState memory tokenState) internal {
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
                    erc20.setAllowance(_address(i), _address(j), tokenState.allowances[i][j]);
                }
            }
        }

        // Oracle price information
        _aaveOracle.setPrice(address(erc20), tokenState.price.inETH);
        _compoundOracle.setPrice(erc20.symbol(), tokenState.price.inUSD);
    }

    /// @return bu_s The Basket Units of the stick DAG
    function _traverseVaults() internal view returns (BU[] memory bu_s) {
        IVault v = _main.manager().vault();
        CollateralToken[] memory collateral;
        IVault[] memory backups;
        do {
            backups = v.getBackups();
            BU[] memory next = new BU[](bu_s.length + 1);
            for (uint256 i = 0; i < bu_s.length; i++) {
                next[i] = bu_s[i];
            }
            collateral = new CollateralToken[](v.size());
            for (uint256 i = 0; i < v.size(); i++) {
                collateral[i] = _reverseCollateral[v.collateralAt(i).erc20()];
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
