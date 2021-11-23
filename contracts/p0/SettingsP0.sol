// SPDX-License-Identifier: BlueOak-1.0.0
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
    using FixLib for Fix;

    Oracle.Info internal _oracle; // TODO: is this intended to be immutable after construction? Should we have setOracle()?
    Config internal _config;

    IStRSR public stRSR;
    IFurnace public furnace;
    IAssetManager public manager;
    IDefaultMonitor public monitor;

    IAsset public rTokenAsset;
    IAsset public rsrAsset;
    IAsset public compAsset;
    IAsset public aaveAsset;

    constructor(Oracle.Info memory oracle_, Config memory config_) {
        _oracle = oracle_;
        _config = config_;
    }

    function setOracle(Oracle.Info memory oracle) external onlyOwner {
        _oracle = oracle;
    }

    function setConfig(Config memory config_) external onlyOwner {
        // When f changes we need to accumulate the historical basket dilution
        if (_config.f.neq(config_.f)) {
            manager.accumulate();
        }
        _config = config_;
    }

    function setStRSR(IStRSR stRSR_) external onlyOwner {
        stRSR = stRSR_;
    }

    function setFurnace(IFurnace furnace_) external onlyOwner {
        furnace = furnace_;
    }

    function setManager(IAssetManager manager_) external onlyOwner {
        manager = manager_;
    }

    function setMonitor(IDefaultMonitor monitor_) external onlyOwner {
        monitor = monitor_;
    }

    function setAssets(
        IAsset rToken_,
        IAsset rsr_,
        IAsset comp_,
        IAsset aave_
    ) external onlyOwner {
        rTokenAsset = rToken_;
        rsrAsset = rsr_;
        compAsset = comp_;
        aaveAsset = aave_;
    }

    // Useful view functions for reading portions of the state

    /// @return {attoUSD/qTok} The price in attoUSD of a `qTok` on oracle `source`.
    function consultOracle(Oracle.Source source, address token) public view returns (Fix) {
        return _oracle.consult(source, token);
    }

    /// @return The deployment of the comptroller on this chain
    function comptroller() public view returns (IComptroller) {
        return _oracle.compound;
    }

    /// @return The deployment of the aave lending pool on this chain
    function aaveLendingPool() public view returns (IAaveLendingPool) {
        return _oracle.aave;
    }

    /// @return The RToken deployment
    function rToken() public view returns (IRToken) {
        return IRToken(address(rTokenAsset.erc20()));
    }

    /// @return The RSR deployment
    function rsr() public view returns (IERC20) {
        return rsrAsset.erc20();
    }

    /// @return The system configuration
    function config() public view returns (Config memory) {
        return _config;
    }
}
