// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "./IAsset.sol";
import "./IMain.sol";
import "./IVault.sol";

interface IAssetManager {
    function issue(address issuer, uint256 amount) external;

    function redeem(address redeemer, uint256 amount) external;

    function runAuctions() external returns (State);

    function accumulate() external;

    function switchVaults(IAsset[] memory defaulting) external;

    function quote(uint256 amount) external view returns (uint256[] memory);

    function fullyCapitalized() external view returns (bool);

    function vault() external view returns (IVault);

    function approvedFiatcoinAssets() external view returns (address[] memory);
}
