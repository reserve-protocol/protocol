// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

interface INotionalProxy {
    /// @notice Claims incentives accrued on all nToken balances and transfers them to the msg.sender
    /// @dev auth:msg.sender
    /// @return Total amount of incentives claimed
    function nTokenClaimIncentives() external returns (uint256);
}
