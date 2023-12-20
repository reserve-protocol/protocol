// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

interface IStargateLPStaking {
    function poolLength() external view returns (uint256);

    function stargate() external view returns (address);

    function eToken() external view returns (address);

    // Info of each pool.
    struct PoolInfo {
        // Address of LP token contract.
        IERC20 lpToken;
        // How many allocation points assigned to this pool. STGs to distribute per block.
        uint256 allocPoint;
        // Last block number that STGs distribution occurs.
        uint256 lastRewardBlock;
        // Accumulated STGs per share, times 1e12. See below.
        uint256 accStargatePerShare;
    }

    function poolInfo(uint256) external view returns (PoolInfo memory);

    function pendingEmissionToken(uint256 _pid, address _user) external view returns (uint256);

    /// @param _pid The pid specifies the pool
    function updatePool(uint256 _pid) external;

    /// @param _pid The pid specifies the pool
    /// @param _amount The amount of the LP token to deposit
    /// @notice Requires appropriate approval to the specified number of tokens
    function deposit(uint256 _pid, uint256 _amount) external;

    /// @param _pid The pid specifies the pool
    /// @param _amount The amount of the LP token to withdraw
    function withdraw(uint256 _pid, uint256 _amount) external;

    /// @notice Withdraw without caring about rewards.
    /// @param _pid The pid specifies the pool
    function emergencyWithdraw(uint256 _pid) external;

    /// @notice handles adding a new LP token (Can only be called by the owner)
    /// @param _allocPoint The alloc point is used as the weight of
    /// the pool against all other alloc points added.
    /// @param _lpToken The lp token address
    function add(uint256 _allocPoint, IERC20 _lpToken) external;

    function owner() external view returns (address);

    function totalAllocPoint() external view returns (uint256);
}
