// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../ERC20Mock.sol";
import "./IStakingPool.sol";

interface IRToken is IERC20 {}

contract RTokenSys0Mock is ERC20Mock, IRToken {
    using SafeERC20 for IRToken;

    IStakingPool public stakingPool;

    constructor(string memory name, string memory symbol) ERC20Mock(name, symbol) {}

    function setStakingPool(address stakingPool_) external {
        stakingPool = IStakingPool(stakingPool_);
    }

    function addRSR(uint256 amount) external {
        IRToken(address(this)).safeApprove(address(stakingPool), amount);
        //safeApprove(address(stakingPool), amount);
        stakingPool.addRSR(amount);
    }
}
