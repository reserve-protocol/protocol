// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "./IAsset.sol";
import "./IVault.sol";

interface IDefaultMonitor {
    function checkForHardDefault(IVault vault, address[] memory allAssets) external override returns (IAsset[] memory);

    function checkForSoftDefault(IVault vault, address[] memory fiatcoins) external override returns (IAsset[] memory);

    function getNextVault(IVault vault, address[] memory approvedCollateral, address[] memory fiatcoins) external override returns (IVault);
}
