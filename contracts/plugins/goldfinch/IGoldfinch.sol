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
