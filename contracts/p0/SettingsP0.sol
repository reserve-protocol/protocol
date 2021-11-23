pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/p0/libraries/Oracle.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/p0/interfaces/IAsset.sol";
import "contracts/p0/interfaces/IAssetManager.sol";
import "contracts/p0/interfaces/IDefaultMonitor.sol";
import "contracts/p0/interfaces/IFurnace.sol";
import "contracts/p0/interfaces/IRToken.sol";
import "contracts/p0/interfaces/IStRSR.sol";
import "contracts/Pausable.sol";

import "contracts/p0/SettingsP0.sol";

/// Settings mixin for Main
contract SettingsP0 is Ownable {
    using Oracle for Oracle.Info;

    Oracle.Info internal _oracle; // TODO: is this intended to be immutable after construction? Should we have setOracle()?
    Config internal _config;

    IStRSR public override stRSR;
    IFurnace public override furnace;
    IAssetManager public override manager;
    IDefaultMonitor public override monitor;

    IAsset public override rTokenAsset;
    IAsset public override rsrAsset;
    IAsset public override compAsset;
    IAsset public override aaveAsset;

    constructor(Oracle.Info memory oracle_, Config memory config_) {
        _oracle = oracle_;
        _config = config_;
    }

    function setOracle(Oracle.Info memory oracle) external override onlyOwner {
        _oracle = oracle;
    }

    function setConfig(Config memory config_) external override onlyOwner {
        // When f changes we need to accumulate the historical basket dilution
        if (_config.f.neq(config_.f)) {
            manager.accumulate();
        }
        _config = config_;
    }

    function setStRSR(IStRSR stRSR_) external override onlyOwner {
        stRSR = stRSR_;
    }

    function setFurnace(IFurnace furnace_) external override onlyOwner {
        furnace = furnace_;
    }

    function setManager(IAssetManager manager_) external override onlyOwner {
        manager = manager_;
    }

    function setMonitor(IDefaultMonitor monitor_) external override onlyOwner {
        monitor = monitor_;
    }

    function setAssets(
        IAsset rToken_,
        IAsset rsr_,
        IAsset comp_,
        IAsset aave_
    ) external override onlyOwner {
        rTokenAsset = rToken_;
        rsrAsset = rsr_;
        compAsset = comp_;
        aaveAsset = aave_;
    }

    // Useful view functions for reading portions of the state

    /// @return {attoUSD/qTok} The price in attoUSD of a `qTok` on oracle `source`.
    function consultOracle(Oracle.Source source, address token) public view override returns (Fix) {
        return _oracle.consult(source, token);
    }

    /// @return The deployment of the comptroller on this chain
    function comptroller() public view override returns (IComptroller) {
        return _oracle.compound;
    }

    /// @return The deployment of the aave lending pool on this chain
    function aaveLendingPool() public view override returns (IAaveLendingPool) {
        return _oracle.aave;
    }

    /// @return The RToken deployment
    function rToken() public view override returns (IRToken) {
        return IRToken(address(rTokenAsset.erc20()));
    }

    /// @return The RSR deployment
    function rsr() public view override returns (IERC20) {
        return rsrAsset.erc20();
    }

    /// @return The system configuration
    function config() public view override returns (Config memory) {
        return _config;
    }
}
