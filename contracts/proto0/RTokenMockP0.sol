// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../test/ERC20Mock.sol";
import "./interfaces/IStakingPool.sol";

interface IRToken is IERC20 {}

contract RTokenMockP0 is ERC20Mock, IRToken {
    using SafeERC20 for IERC20;
    using SafeERC20 for IRToken;

    IStakingPool public stakingPool;
    IERC20 public rsr;

    constructor(
        string memory name,
        string memory symbol,
        address rsr_
    ) ERC20Mock(name, symbol) {
        rsr = IERC20(rsr_);
    }

    function setStakingPool(address stakingPool_) external {
        stakingPool = IStakingPool(stakingPool_);
    }

    function addRSR(uint256 amount) external {
        rsr.safeApprove(address(stakingPool), amount);
        stakingPool.addRSR(amount);
    }

    function seizeRSR(uint256 amount) external {
        stakingPool.seizeRSR(amount);
    }
}
