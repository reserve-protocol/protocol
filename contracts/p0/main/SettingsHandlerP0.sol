// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/p0/libraries/Oracle.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/p0/interfaces/IAsset.sol";
import "contracts/p0/interfaces/IFurnace.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/interfaces/IRToken.sol";
import "contracts/p0/interfaces/IStRSR.sol";
import "contracts/p0/interfaces/IVault.sol";
import "contracts/p0/main/Mixin.sol";

/// Settings mixin for Main
contract SettingsHandlerP0 is Ownable, Mixin, ISettingsHandler {
    using Oracle for Oracle.Info;
    using FixLib for Fix;

    Oracle.Info internal _oracle;
    Config internal _config;

    uint256 public rewardStart;
    uint256 public rewardPeriod;
    uint256 public auctionPeriod;
    uint256 public stRSRWithdrawalDelay;
    uint256 public defaultDelay;

    Fix public maxTradeSlippage;
    Fix public maxAuctionSize;
    Fix public minRecapitalizationAuctionSize;
    Fix public minRevenueAuctionSize;
    Fix public migrationChunk;
    Fix public issuanceRate;
    Fix public defaultThreshold;

    IStRSR public override stRSR;
    IFurnace public override furnace;

    IAsset public rTokenAsset;
    IAsset public rsrAsset;
    IAsset public compAsset;
    IAsset public aaveAsset;

    function init(ConstructorArgs calldata args) public virtual override {
        super.init(args);
        _oracle = args.oracle;
        _config = args.config;
    }

    function setOracle(Oracle.Info memory oracle_) external override onlyOwner {
        _oracle = oracle_;
    }

    function setConfig(Config memory config_) public virtual override onlyOwner {
        _config = config_;
    }

    function setStRSR(IStRSR stRSR_) external override onlyOwner {
        stRSR = stRSR_;
    }

    function setFurnace(IFurnace furnace_) external override onlyOwner {
        furnace = furnace_;
    }

    function setRTokenAsset(IAsset rTokenAsset_) external override onlyOwner {
        rTokenAsset = rTokenAsset_;
    }

    function setRSRAsset(IAsset rsrAsset_) external override onlyOwner {
        rsrAsset = rsrAsset_;
    }

    function setCompAsset(IAsset compAsset_) external override onlyOwner {
        compAsset = compAsset_;
    }

    function setAaveAsset(IAsset aaveAsset_) external override onlyOwner {
        aaveAsset = aaveAsset_;
    }

    // Useful view functions for reading portions of the state

    /// @return {attoUSD/qTok} The price in attoUSD of a `qTok` on _oracle `source`.
    function consultOracle(Oracle.Source source, address token) public view override returns (Fix) {
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
