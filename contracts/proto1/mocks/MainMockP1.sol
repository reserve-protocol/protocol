// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../interfaces/IStRSRP1.sol";
import "../interfaces/IMainP1.sol";
import "contracts/proto1/libraries/OracleP1.sol";
import "contracts/libraries/Fixed.sol";

contract ManagerInternalMockP1 {
    bool public fullyCapitalized;
    IMainP1 public main;

    constructor(address main_) {
        fullyCapitalized = true;
        main = IMainP1(main_);
    }

    function setFullyCapitalized(bool value) external {
        fullyCapitalized = value;
    }

    function seizeRSR(uint256 amount) external {
        main.stRSR().seizeRSR(amount);
    }
}

contract MainMockP1 {
    IERC20 public rsr;
    ManagerInternalMockP1 public manager;
    bool public paused;

    IStRSRP1 public stRSR;

    Config private _config;

    constructor(IERC20 rsr_, uint256 stRSRWithdrawalDelay_) {
        _config.stRSRWithdrawalDelay = stRSRWithdrawalDelay_;
        rsr = rsr_;
        manager = new ManagerInternalMockP1(address(this));
        paused = false;
    }

    function setStRSR(IStRSRP1 stRSR_) external {
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
}
