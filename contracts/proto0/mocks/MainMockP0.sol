// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../interfaces/IStRSR.sol";
import "../interfaces/IMain.sol";
import "../interfaces/IVault.sol";
import "contracts/proto0/libraries/Oracle.sol";
import "contracts/libraries/Fixed.sol";

contract ManagerInternalMockP0 {
    bool public fullyCapitalized;
    IMain public main;
    IVault public vault;

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

    function setVault(IVault vault_) external {
        vault = vault_;
    }

    function baseFactor() external returns (Fix) {
        return FIX_ONE;
    }
}

contract MainMockP0 {
    IERC20 public rsr;
    ManagerInternalMockP0 public manager;
    bool public paused;

    IStRSR public stRSR;

    Config private _config;

    constructor(IERC20 rsr_, uint256 stRSRWithdrawalDelay_) {
        _config.stRSRWithdrawalDelay = stRSRWithdrawalDelay_;
        rsr = rsr_;
        manager = new ManagerInternalMockP0(address(this));
        paused = false;
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

    function config() external view returns (Config memory) {
        return _config;
    }

    /// @return {attoUSD/qTok} The price in attoUSD of `token` on Compound
    function consultOracle(Oracle.Source, address token) external view returns (Fix) {
        return toFixWithShift(1, 18 - int8(IERC20Metadata(token).decimals()));
    }

    function setVault(IVault vault) external {
        manager.setVault(vault);
    }
}
