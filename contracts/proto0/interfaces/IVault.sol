// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "../interfaces/IAsset.sol";
import "../interfaces/IMain.sol";

/// @param assets Mapping from an incremental index to asset
/// @param quantities Mapping from asset to quantity of asset that is in one BU (1e18)
/// @param size The number of assets in the basket
struct Basket {
    mapping(uint256 => IAsset) assets;
    mapping(IAsset => uint256) quantities;
    uint256 size;
}

interface IVault {
    function issue(uint256 amount) external;

    function redeem(address redeemer, uint256 amount) external;

    function setAllowance(address spender, uint256 amount) external;

    function pullBUs(address from, uint256 amount) external;

    function claimAndSweepRewardsToManager() external;

    function updateCompoundAaveRates() external;

    function basketRate() external view returns (uint256);

    function containsOnly(address[] memory assets) external view returns (bool);

    function maxIssuable(address issuer) external view returns (uint256);

    function tokenAmounts(uint256 amount) external view returns (uint256[] memory);

    function assetAt(uint256 index) external view returns (IAsset);

    function size() external view returns (uint256);

    function basketUnits(address account) external view returns (uint256);

    function quantity(IAsset asset) external view returns (uint256);

    function getBackups() external view returns (IVault[] memory);
}
