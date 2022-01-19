// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "../interfaces/IStRSR.sol";
import "../interfaces/IMain.sol";
import "contracts/p0/interfaces/IOracle.sol";
import "contracts/p0/Asset.sol";
import "contracts/p0/Oracle.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/mocks/ERC20Mock.sol";
import "./CompoundOracleMock.sol";
import "./ComptrollerMock.sol";
import "./AaveOracleMock.sol";
import "./AaveLendingAddrProviderMock.sol";
import "./AaveLendingPoolMock.sol";

// TODO Do we still need to mock main?

contract ManagerInternalMockP0 {
    bool public fullyCapitalized;
    IMain public main;

    // IVault public vault;

    constructor(address main_) {
        fullyCapitalized = true;
        main = IMain(main_);
    }

    function setFullyCapitalized(bool value) external {
        fullyCapitalized = value;
    }

    function seizeRSR(uint256 amount) external {
        main.stRSR().seizeRSR(amount);
    }

    // function setVault(IVault vault_) external {
    //     vault = vault_;
    // }

    function baseFactor() external pure returns (Fix) {
        return FIX_ONE;
    }
}

contract MainMockP0 {
    IERC20Metadata public rsr;
    ManagerInternalMockP0 public manager;
    bool public paused;

    uint256 public stRSRWithdrawalDelay;
    Fix public defaultThreshold;

    IStRSR public stRSR;
    IComptroller public comptroller;
    ICompoundOracle public compoundOracle;

    IAaveOracle private _aaveOracleMock;
    ILendingPoolAddressesProvider private _aaveAddrProvider;
    IAaveLendingPool public aaveLendingPool;

    IOracle internal _compoundOracle;
    IOracle internal _aaveOracle;

    IAsset public compAsset;
    IAsset public aaveAsset;

    constructor(
        IERC20Metadata rsr_,
        IERC20Metadata compToken,
        IERC20Metadata aaveToken,
        IERC20Metadata weth,
        uint256 stRSRWithdrawalDelay_,
        Fix defaultThreshold_
    ) {
        stRSRWithdrawalDelay = stRSRWithdrawalDelay_;
        defaultThreshold = defaultThreshold_;

        rsr = rsr_;
        manager = new ManagerInternalMockP0(address(this));
        paused = false;

        compoundOracle = new CompoundOracleMockP0();
        comptroller = new ComptrollerMockP0(address(compoundOracle));

        _aaveOracleMock = new AaveOracleMockP0(address(weth));
        _aaveAddrProvider = new AaveLendingAddrProviderMockP0(address(_aaveOracleMock));
        aaveLendingPool = new AaveLendingPoolMockP0(address(_aaveAddrProvider));

        _compoundOracle = new CompoundOracle(comptroller);
        _aaveOracle = new AaveOracle(comptroller, aaveLendingPool);

        compAsset = new AssetP0(compToken, IMain(address(this)), _compoundOracle);
        aaveAsset = new AssetP0(aaveToken, IMain(address(this)), _aaveOracle);
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
        stRSRWithdrawalDelay = stRSRWithdrawalDelay_;
    }

    function setDefaultThreshold(Fix defaultThreshold_) public {
        defaultThreshold = defaultThreshold_;
    }
}
