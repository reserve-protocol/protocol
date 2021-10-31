// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "./IAsset.sol";
import "./IMain.sol";
import "./IVault.sol";

interface IAssetManager {
    function update() external; // block-by-block idempotent updates

    function completeIssuance(SlowIssuance memory issuance) external;

    function redeem(address redeemer, uint256 rTokenAmount) external;

    function doAuctions() external returns (State);

    function collectRevenue() external;

    function accumulate() external;

    function switchVaults(IAsset[] memory defaulting) external;

    function toBUs(uint256 rTokenAmount) external view returns (uint256);

    function fromBUs(uint256 BUs) external view returns (uint256);

    function fullyCapitalized() external view returns (bool);

    function vault() external view returns (IVault);

    function approvedFiatcoinAssets() external view returns (address[] memory);
}
