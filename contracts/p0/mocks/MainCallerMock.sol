// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../interfaces/IMain.sol";
import "contracts/p0/Main.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/Component.sol";

contract MainCallerMockP0 is Component {
    IMain main;

    constructor(IMain main_) {
        main = main_;
    }

    function seizeRSR(uint256 amount) external {
        IStRSR(main.addr(ST_RSR)).seizeRSR(amount);
    }

    function paused() external view returns (bool) {
        return main.paused();
    }

    function fullyCapitalized() external view returns (bool) {
        return main.fullyCapitalized();
    }

    function worstCollateralStatus() external view returns (CollateralStatus) {
        return main.worstCollateralStatus();
    }

    function rsr() external view returns (IERC20) {
        return IERC20(main.addr(RSR));
    }

    function stRSRWithdrawalDelay() external view returns (uint256) {
        return main.Uint(ST_RSR_WITHDRAWAL_DELAY);
    }

    function stRSRPayPeriod() external view returns (uint256) {
        return main.Uint(ST_RSR_PAY_PERIOD);
    }

    function stRSRPayRatio() external view returns (Fix) {
        return main.fix(ST_RSR_PAY_RATIO);
    }
}
