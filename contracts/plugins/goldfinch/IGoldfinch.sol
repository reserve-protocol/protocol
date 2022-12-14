// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

/// External Interface for Goldfinch

interface IGoldfinchSeniorPool {
    function sharePrice() external view returns (uint256);

    function config() external view returns (IGoldfinchConfig);

    function redeem(uint256 _tokenId) external;
}

interface IGoldfinchConfig {
    function getNumber(uint256 index) external returns (uint256);
}

interface IGoldfinchLegacyConfig {
    function addToGoList(address _member) external;
}

enum StakedPositionType {
    Fidu,
    CurveLP
}

interface IGoldfinchStaking {
    function stake(uint256 amount, StakedPositionType positionType) external returns (uint256);

    function unstake(uint256 tokenId, uint256 amount) external;

    function addToStake(uint256 tokenId, uint256 amount) external;

    function getReward(uint256 tokenId) external;

    function stakedBalanceOf(uint256 tokenId) external view returns (uint256);

    function earnedSinceLastCheckpoint(uint256 tokenId) external view returns (uint256);
}
