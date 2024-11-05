// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

interface IAeroGauge {
    error ZeroAmount();

    /// @notice Address of the pool LP token which is deposited (staked) for rewards
    function stakingToken() external view returns (address);

    /// @notice Address of the token (AERO) rewarded to stakers
    function rewardToken() external view returns (address);

    /// @notice Cached amount of rewardToken earned for an account
    function rewards(address) external view returns (uint256);

    /// @notice Returns accrued balance to date from last claim / first deposit.
    function earned(address _account) external view returns (uint256);

    /// @notice Retrieve rewards for an address.
    /// @dev Throws if not called by same address or voter.
    /// @param _account .
    function getReward(address _account) external;

    /// @notice Deposit LP tokens into gauge for msg.sender
    /// @param _amount .
    function deposit(uint256 _amount) external;

    /// @notice Deposit LP tokens into gauge for any user
    /// @param _amount .
    /// @param _recipient Recipient to give balance to
    function deposit(uint256 _amount, address _recipient) external;

    /// @notice Withdraw LP tokens for user
    /// @param _amount .
    function withdraw(uint256 _amount) external;
}
