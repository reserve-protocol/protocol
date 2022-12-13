// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

/// External Interface for CTokens
// See: https://github.com/compound-finance/compound-protocol/blob/master/contracts/CToken.sol

interface ITFToken {
    function poolValue() external view returns (uint256);

    function totalSupply() external view returns (uint256);
}

interface ITRUFarm {
    function claimable(address token, address account) external view returns (uint256);

    function claim(address[] calldata tokens) external;

    function rewardToken() external view returns (address);
}
