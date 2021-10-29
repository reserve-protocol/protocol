// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "./IAsset.sol";
import "./IVault.sol";

interface IDefaultMonitor {
    function checkForHardDefault(IVault vault) external returns (IAsset[] memory);

    function checkForSoftDefault(IVault vault, address[] memory fiatcoins) external view returns (IAsset[] memory);

    function getNextVault(
        IVault vault,
        address[] memory approvedCollateral,
        address[] memory fiatcoins
    ) external view returns (IVault);
}
