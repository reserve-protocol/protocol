// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/test/ProtoDriver.sol";
import "contracts/test/ProtoState.sol";
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
import "contracts/p0/mocks/RTokenMockP0.sol";
import "contracts/p0/VaultP0.sol";
import "./Extensions.sol";

interface IMintERC20 is IERC20Metadata {
    function mint(address recipient, uint256 amount) external;
}

contract AdapterP0 is ProtoDriver {
    using strings for string;
    using strings for strings.slice;

    address internal _owner;

    IDeployer internal _deployer;
    IMintERC20 internal _rsr;
    IMintERC20 internal _comp;
    IMintERC20 internal _aave;
    IMainExtension internal _main;

    mapping(CollateralToken => ICollateral) internal _collateral;
    mapping(IERC20 => CollateralToken) internal _reverseCollateral; // by the ERC20 of the collateral

    uint256 internal immutable ACCOUNT_LEN = uint256(Account.EVE) + 1;
    uint256 internal immutable COLLATERAL_TOKEN_LEN = uint256(CollateralToken.aBUSD) + 1;

    constructor() {
        _owner = msg.sender;
        _deployer = new DeployerExtension();
    }

    function init(ProtoState memory s) external override {
        ICollateral[] memory collateral = new ICollateral[](COLLATERAL_TOKEN_LEN);
        {
            // Deploy collateral assets
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

            collateral[0] = _initCollateral(IMintERC20(address(dai)), s.collateral[0], CollateralToken.DAI);
            collateral[1] = _initCollateral(IMintERC20(address(usdc)), s.collateral[1], CollateralToken.USDC);
            collateral[2] = _initCollateral(IMintERC20(address(usdt)), s.collateral[2], CollateralToken.USDT);
            collateral[3] = _initCollateral(IMintERC20(address(busd)), s.collateral[3], CollateralToken.BUSD);
            collateral[4] = _initCollateral(IMintERC20(address(cDAI)), s.collateral[4], CollateralToken.cDAI);
            collateral[5] = _initCollateral(IMintERC20(address(cUSDC)), s.collateral[5], CollateralToken.cUSDC);
            collateral[6] = _initCollateral(IMintERC20(address(cUSDT)), s.collateral[6], CollateralToken.cUSDT);
            collateral[7] = _initCollateral(IMintERC20(address(aDAI)), s.collateral[7], CollateralToken.aDAI);
            collateral[8] = _initCollateral(IMintERC20(address(aUSDC)), s.collateral[8], CollateralToken.aUSDC);
            collateral[9] = _initCollateral(IMintERC20(address(aUSDT)), s.collateral[9], CollateralToken.aUSDT);
            collateral[10] = _initCollateral(IMintERC20(address(aBUSD)), s.collateral[10], CollateralToken.aBUSD);
        }

        // Deploy vault for each basket
        IVault[] memory vaults = new IVault[](s.baskets.length);
        for (int256 i = int256(s.baskets.length) - 1; i >= 0; i--) {
            uint256 iUint = uint256(i);
            IVault[] memory prevVaults = new IVault[](s.baskets.length - 1 - iUint);
            for (uint256 j = iUint + 1; j < s.baskets.length; j++) {
                prevVaults[j - (iUint + 1)] = vaults[j];
            }

            ICollateral[] memory backing = new ICollateral[](s.baskets[iUint].tokens.length);
            for (uint256 j = 0; j < s.baskets[iUint].tokens.length; j++) {
                backing[j] = _collateral[s.baskets[iUint].tokens[j]];
            }

            vaults[iUint] = new VaultP0(backing, s.baskets[iUint].quantities, prevVaults);
        }

        // Deploy non-collateral assets
        IDeployer.ParamsAssets memory nonCollateral;
        {
            _rsr = IMintERC20(address(new ERC20Mock(s.rsr.name, s.rsr.symbol)));
            _comp = IMintERC20(address(new ERC20Mock(s.comp.name, s.comp.symbol)));
            _aave = IMintERC20(address(new ERC20Mock(s.aave.name, s.aave.symbol)));
            RSRAssetP0 rsrAsset = new RSRAssetP0(address(_rsr));
            COMPAssetP0 compAsset = new COMPAssetP0(address(_comp));
            AAVEAssetP0 aaveAsset = new AAVEAssetP0(address(_aave));
            nonCollateral = IDeployer.ParamsAssets(rsrAsset, compAsset, aaveAsset);

            // Mint starting balances
            for (uint256 i = 0; i < s.rsr.balances.length; i++) {
                _rsr.mint(_address(i), s.rsr.balances[i]);
            }
            for (uint256 i = 0; i < s.stRSR.balances.length; i++) {
                _rsr.mint(_address(i), s.stRSR.balances[i]); // Mint stRSR to RSR, then stake
            }
            for (uint256 i = 0; i < s.comp.balances.length; i++) {
                _comp.mint(_address(i), s.comp.balances[i]);
            }
            for (uint256 i = 0; i < s.aave.balances.length; i++) {
                _aave.mint(_address(i), s.aave.balances[i]);
            }
        }

        // Deploy system
        _main = IMainExtension(
            _deployer.deploy(
                s.rToken.name,
                s.rToken.symbol,
                _owner,
                vaults[0],
                _rsr,
                s.config,
                s.comptroller,
                s.aaveLendingPool,
                nonCollateral,
                collateral
            )
        );

        // stRSR
        for (uint256 i = 0; i < s.stRSR.balances.length; i++) {
            _main.connect(_address(i));
            _main.stRSR().stake(s.stRSR.balances[i]);
        }
        // rToken
        for (uint256 i = 0; i < s.rToken.balances.length; i++) {
            RTokenExtension(address(_main.rToken())).adminMint(_address(i), s.rToken.balances[i]);
        }
    }

    function state() external override returns (ProtoState memory s) {
        s.config = _main.config();
        s.comptroller = _main.comptroller();
        s.aaveLendingPool = _main.aaveLendingPool();

        address[] memory backingTokens = _main.backingTokens();
        CollateralToken[] memory backingCollateral = new CollateralToken[](backingTokens.length);
        for (uint256 i = 0; i < backingTokens.length; i++) {
            backingCollateral[i] = _reverseCollateral[IERC20(backingTokens[i])];
        }
        s.rTokenRedemption = GenericBasket(backingCollateral, _main.quote(10**_main.rToken().decimals()));
        s.rToken = _dumpERC20(address(_main.rToken()));
        s.rsr = _dumpERC20(address(_main.rsr()));
        s.stRSR = _dumpERC20(address(_main.stRSR()));
        s.comp = _dumpERC20(address(_main.compAsset().erc20()));
        s.aave = _dumpERC20(address(_main.aaveAsset().erc20()));
        s.collateral = new ERC20State[](COLLATERAL_TOKEN_LEN);
        for (uint256 i = 0; i < COLLATERAL_TOKEN_LEN; i++) {
            s.collateral[i] = _dumpERC20(address(_collateral[CollateralToken(i)].erc20()));
        }
    }

    // === COMMANDS ====

    function CMD_issue(Account account, uint256 amount) external override {
        _main.connect(_address(uint256(account)));
        _main.issue(amount);
    }

    function CMD_redeem(Account account, uint256 amount) external override {
        // _main.redeem(amount);
    }

    function CMD_checkForDefault(Account account) external override {
        // _main.noticeDefault();
    }

    function CMD_poke(Account account) external override {
        // _main.poke();
    }

    function CMD_stakeRSR(Account account, uint256 amount) external override {}

    function CMD_unstakeRSR(Account account, uint256 amount) external override {}

    function CMD_setRTokenForMelting(Account account, uint256 amount) external override {}

    function CMD_transferRToken(
        Account from,
        Account to,
        uint256 amount
    ) external override {}

    function CMD_transferRSR(
        Account from,
        Account to,
        uint256 amount
    ) external override {}

    function CMD_transferStRSR(
        Account from,
        Account to,
        uint256 amount
    ) external override {}

    // === INVARIANTS ====

    function INVARIANT_isFullyCapitalized() external view override returns (bool) {
        return _main.manager().fullyCapitalized();
    }

    // =================================================================

    /// @param addr The address of an ERC20 token
    function _dumpERC20(address addr) internal view returns (ERC20State memory erc20State) {
        IERC20Metadata erc20 = IERC20Metadata(addr);
        erc20State.name = erc20.name();
        erc20State.name = erc20.symbol();
        erc20State.balances = new uint256[](ACCOUNT_LEN);
        for (uint256 i = 0; i < ACCOUNT_LEN; i++) {
            erc20State.balances[i] = erc20.balanceOf(_address(i));
        }
        erc20State.totalSupply = erc20.totalSupply();
    }

    /// Deploys Collateral contracts and mints initial balances
    function _initCollateral(
        IMintERC20 erc20,
        ERC20State memory erc20State,
        CollateralToken ct
    ) internal returns (ICollateral) {
        assert(keccak256(bytes(erc20.symbol())) == keccak256(bytes(erc20State.symbol)));
        for (uint256 i = 0; i < erc20State.balances.length; i++) {
            erc20.mint(_address(i), erc20State.balances[i]);
        }
        // assert(erc20.totalSupply() == erc20State.totalSupply);

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

    /// Account index -> address
    function _address(uint256 index) internal pure returns (address) {
        // Use 0x1, 0x2, ...
        return address((uint160(index) + 1));
    }
}
