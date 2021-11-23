// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../interfaces/IStRSR.sol";
import "../interfaces/IMain.sol";
import "../interfaces/IVault.sol";
import "contracts/p0/libraries/Oracle.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/mocks/ERC20Mock.sol";
import "contracts/p0/DefaultMonitorP0.sol";
import "contracts/p0/assets/COMPAssetP0.sol";
import "contracts/p0/assets/AAVEAssetP0.sol";
import "./CompoundOracleMockP0.sol";
import "./ComptrollerMockP0.sol";
import "./AaveOracleMockP0.sol";
import "./AaveLendingAddrProviderMockP0.sol";
import "./AaveLendingPoolMockP0.sol";

contract ManagerInternalMockP0 {
    bool public fullyCapitalized;
    IMainP0 public main;
    IVault public vault;

    constructor(address main_) {
        fullyCapitalized = true;
        main = IMainP0(main_);
    }

    function setFullyCapitalized(bool value) external {
        fullyCapitalized = value;
    }

    function seizeRSR(uint256 amount) external {
        main.stRSR().seizeRSR(amount);
    }

    function setVault(IVault vault_) external {
        vault = vault_;
    }

    function baseFactor() external returns (Fix) {
        return FIX_ONE;
    }
}

contract MainMockP0 {
    using Oracle for Oracle.Info;

    IERC20 public rsr;
    ManagerInternalMockP0 public manager;
    bool public paused;

    IStRSR public stRSR;
    IDefaultMonitor public monitor;

    Config private _config;

    ICompoundOracle private _compOracle;
    IComptroller public comptroller;

    IAaveOracle private _aaveOracle;
    ILendingPoolAddressesProvider private _aaveAddrProvider;
    IAaveLendingPool public aaveLendingPool;

    Oracle.Info internal _oracle;

    IAsset public compAsset;
    IAsset public aaveAsset;

    constructor(
        IERC20 rsr_,
        IERC20 compToken,
        IERC20 aaveToken,
        IERC20 weth,
        uint256 stRSRWithdrawalDelay_,
        Fix defaultThreshold_
    ) {
        _config.stRSRWithdrawalDelay = stRSRWithdrawalDelay_;
        _config.defaultThreshold = defaultThreshold_;

        rsr = rsr_;
        manager = new ManagerInternalMockP0(address(this));
        monitor = new DefaultMonitorP0(IMainP0(address(this)));
        paused = false;

        _compOracle = new CompoundOracleMockP0();
        comptroller = new ComptrollerMockP0(address(_compOracle));

        _aaveOracle = new AaveOracleMockP0(address(weth));
        _aaveAddrProvider = new AaveLendingAddrProviderMockP0(address(_aaveOracle));
        aaveLendingPool = new AaveLendingPoolMockP0(address(_aaveAddrProvider));

        _oracle = Oracle.Info(comptroller, aaveLendingPool);

        compAsset = new COMPAssetP0(address(compToken));
        aaveAsset = new AAVEAssetP0(address(aaveToken));
    }

    function setStRSR(IStRSR stRSR_) external {
        stRSR = stRSR_;
    }

    function pause() external {
        paused = true;
    }

    function unpause() external {
        paused = false;
    }

    function setStRSRWithdrawalDelay(uint256 stRSRWithdrawalDelay_) public {
        _config.stRSRWithdrawalDelay = stRSRWithdrawalDelay_;
    }

    function setDefaultThreshold(Fix defaultThreshold_) public {
        _config.defaultThreshold = defaultThreshold_;
    }

    function config() external view returns (Config memory) {
        return _config;
    }

    /// @return {attoUSD/qTok} The price in attoUSD of a `qTok` on oracle `source`.
    function consultOracle(Oracle.Source source, address token) external view returns (Fix) {
        return _oracle.consult(source, token);
    }

    function compoundOracle() external view returns (address) {
        return address(_compOracle);
    }

    function aaveOracle() external view returns (address) {
        return address(_aaveOracle);
    }

    function setVault(IVault vault) external {
        manager.setVault(vault);
    }

    function checkForHardDefault(IVault vault) external returns (ICollateral[] memory defaulting) {
        return monitor.checkForHardDefault(vault);
    }
}
