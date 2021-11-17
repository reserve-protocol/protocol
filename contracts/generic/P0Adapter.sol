// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/proto0/assets/collateral/ATokenCollateralP0.sol";
import "contracts/proto0/assets/collateral/CTokenCollateralP0.sol";
import "contracts/proto0/assets/collateral/CollateralP0.sol";
import "contracts/proto0/interfaces/IAsset.sol";
import "contracts/proto0/interfaces/IDeployer.sol";
import "contracts/proto0/interfaces/IMain.sol";
import "contracts/proto0/interfaces/IVault.sol";
import "contracts/mocks/ATokenMock.sol";
import "contracts/mocks/CTokenMock.sol";
import "contracts/mocks/ERC20Mock.sol";
import "contracts/mocks/USDCMock.sol";
import "contracts/proto0/DeployerP0.sol";
import "contracts/proto0/VaultP0.sol";
import "./ProtoDriver.sol";
import "./ProtoState.sol";

contract P0Adapter is ProtoDriver {
    address internal _owner;

    IDeployer internal _deployer;
    IERC20 internal _rsr;
    IERC20 internal _comp;
    IERC20 internal _aave;
    IMain internal _main;

    mapping(CollateralToken => ICollateral) internal _collateral;

    function constructor_() external override {
        _owner = msg.sender;
        _deployer = new DeployerP0();
    }

    function init(ProtoState memory state) external override {
        IVault[] memory vaults = new IVault[](state.baskets.length);
        for (uint256 i = state.baskets.length - 1; i >= 0; i--) {
            IVault[] memory prevVaults = new IVault[](state.baskets.length - 1 - i);
            for (uint256 j = i; j < state.baskets.length; j++) {
                prevVaults[j - i] = vaults[j];
            }

            ICollateral[] memory collateral = new ICollateral[](state.baskets[i].tokens.length);
            for (uint256 j = 0; j < state.baskets[i].tokens.length; j++) {
                collateral[j] = _iCollateral(state.baskets[i].tokens[j]);
            }

            vaults[i] = new VaultP0(collateral, state.baskets[i].quantities, prevVaults);
        }

        _rsr = new ERC20("RSR", "Reserve Rights Token");
        _comp = new ERC20("COMP", "Compound Token");
        _aave = new ERC20("AAVE", "Aave Token");

        RSRAssetP0 rsrAsset = new RSRAssetP0(address(_rsr));
        COMPAssetP0 compAsset = new COMPAssetP0(address(_comp));
        AAVEAssetP0 aaveAsset = new AAVEAssetP0(address(_aave));

        IDeployer.ParamsAssets memory nonCollateral = IDeployer.ParamsAssets(rsrAsset, compAsset, aaveAsset);

        ICollateral[] memory collateral = new ICollateral[](state.baskets[0].tokens.length);
        for (uint256 i = 0; i < state.baskets[0].tokens.length; i++) {
            collateral[i] = _iCollateral(state.baskets[0].tokens[i]);
        }

        _main = IMain(
            _deployer.deploy(
                state.rToken.name,
                state.rToken.symbol,
                _owner,
                vaults[0],
                _rsr,
                state.config,
                state.comptroller,
                state.aaveLendingPool,
                nonCollateral,
                collateral
            )
        );
    }

    function state() external view override returns (ProtoState memory state) {}

    // COMMANDS
    function CMD_issue(Account account, uint256 amount) external override {}

    function CMD_redeem(Account account, uint256 amount) external override {}

    function CMD_checkForDefault(Account account) external override {}

    function CMD_poke(Account account) external override {}

    // function CMD_setOraclePrices(CollateralToken[] memory tokens, Fix[] prices) external;

    // function CMD_setDefiRates(
    //     DefiProtocol protocol,
    //     CollateralToken[] memory tokens,
    //     Fix[] redemptionRates
    // ) external;

    // INVARIANTS
    function INVARIANT_isFullyCapitalized() external view override returns (bool) {}

    // =================================================================

    /// @return Returns a deployment of the p0 Collateral contract, creating one if needed.
    function _iCollateral(CollateralToken token) internal returns (ICollateral) {
        if (address(_collateral[token]) == address(0)) {
            if (token == CollateralToken.DAI) {
                _collateral[token] = new CollateralP0(address(new ERC20Mock("DAI", "DAI Token")));
            } else if (token == CollateralToken.USDC) {
                _collateral[token] = new CollateralP0(address(new USDCMock("USDC", "USDC Token")));
            } else if (token == CollateralToken.USDT) {
                _collateral[token] = new CollateralP0(address(new ERC20Mock("USDT", "USDT Token")));
            } else if (token == CollateralToken.BUSD) {
                _collateral[token] = new CollateralP0(address(new ERC20Mock("BUSD", "BUSD Token")));
            } else if (token == CollateralToken.cDAI) {
                ICollateral dai = _iCollateral(CollateralToken.DAI);
                address cDai = address(new CTokenMock("cDAI", "Compound DAI Token", address(dai)));
                _collateral[token] = new CTokenCollateralP0(cDai);
            } else if (token == CollateralToken.cUSDC) {
                ICollateral usdc = _iCollateral(CollateralToken.USDC);
                address cUsdc = address(new CTokenMock("cUSDC", "Compound USDC Token", address(usdc)));
                _collateral[token] = new CTokenCollateralP0(cUsdc);
            } else if (token == CollateralToken.cUSDT) {
                ICollateral usdt = _iCollateral(CollateralToken.USDT);
                address cUsdt = address(new CTokenMock("cUSDT", "Compound USDT Token", address(usdt)));
                _collateral[token] = new CTokenCollateralP0(cUsdt);
            } else if (token == CollateralToken.aDAI) {
                ICollateral dai = _iCollateral(CollateralToken.DAI);
                address aDai = address(new StaticATokenMock("aDAI", "Aave DAI Token", address(dai)));
                _collateral[token] = new ATokenCollateralP0(aDai);
            } else if (token == CollateralToken.aUSDC) {
                ICollateral usdc = _iCollateral(CollateralToken.USDC);
                address aUsdc = address(new StaticATokenMock("aUSDC", "Aave USDC Token", address(usdc)));
                _collateral[token] = new ATokenCollateralP0(aUsdc);
            } else if (token == CollateralToken.aUSDT) {
                ICollateral usdt = _iCollateral(CollateralToken.USDT);
                address aUsdt = address(new StaticATokenMock("aUSDT", "Aave USDT Token", address(usdt)));
                _collateral[token] = new ATokenCollateralP0(aUsdt);
            } else if (token == CollateralToken.aBUSD) {
                ICollateral busd = _iCollateral(CollateralToken.BUSD);
                address aBusd = address(new StaticATokenMock("aBUSD", "Aave BUSD Token", address(busd)));
                _collateral[token] = new ATokenCollateralP0(aBusd);
            } else {
                assert(false);
            }
            return _collateral[token];
        }
    }
}
