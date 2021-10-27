// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "../interfaces/IAsset.sol";

struct Basket {
    mapping(uint256 => IAsset) assets;
    mapping(uint256 => uint256) quantities;
    uint256 size;
}

interface IVault {
    function issue(uint256 amount) external;

    function redeem(address redeemer, uint256 amount) external;

    function basketFiatcoinRate() external view returns (uint256);

    function containsOnly(address[] memory assets) external view returns (bool);

    function maxIssuable(address issuer) external view returns (uint256);

    function tokenAmounts(uint256 amount) external view returns (uint256[] memory);

    function assetAt(uint256 index) external view returns (IAsset);

    function size() external view returns (uint256);

    function basketUnits(address account) external view returns (uint256);

    function quantity(IAsset asset) external view returns (uint256);

    function getBackups() external view returns (IVault[] memory);
}
