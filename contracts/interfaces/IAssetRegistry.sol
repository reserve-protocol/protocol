// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "contracts/interfaces/IAsset.sol";
import "./IComponent.sol";

interface IAssetRegistry is IComponent {
    /// Emitted when an asset is added to the registry
    /// @param erc20 The ERC20 contract for the asset
    /// @param asset The asset contract added to the registry
    event AssetRegistered(IERC20Metadata indexed erc20, IAsset indexed asset);

    /// Emitted when an asset is removed from the registry
    /// @param erc20 The ERC20 contract for the asset
    /// @param asset The asset contract removed from the registry
    event AssetUnregistered(IERC20Metadata indexed erc20, IAsset indexed asset);

    function toAsset(IERC20Metadata erc20) external view returns (IAsset);

    function toColl(IERC20Metadata erc20) external view returns (ICollateral);

    function isRegistered(IERC20Metadata erc20) external view returns (bool);

    function registeredERC20s() external view returns (IERC20Metadata[] memory);
}
