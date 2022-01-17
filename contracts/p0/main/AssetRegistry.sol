// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "contracts/p0/interfaces/IAsset.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/main/Mixin.sol";

contract AssetRegistryP0 is Ownable, Mixin, IAssetRegistry {
    using EnumerableSet for EnumerableSet.AddressSet;

    EnumerableSet.AddressSet internal _assets;

    function init(ConstructorArgs calldata args) public virtual override {
        super.init(args);
    }

    function addAsset(IAsset asset) external onlyOwner {
        _assets.add(address(asset));
    }

    function removeAsset(IAsset asset) external onlyOwner {
        _assets.remove(address(asset));
    }

    function disableCollateral(ICollateral collateral) external override onlyOwner {
        require(collateral.isCollateral(), "can only disable ICollateral assets");
        collateral.disable();
    }

    function isRegistered(IAsset asset) external view override returns (bool) {
        return _assets.contains(address(asset));
    }

    function allAssets() external view override returns (IAsset[] memory assets) {
        assets = new IAsset[](_assets.length());
        for (uint256 i = 0; i < _assets.length(); i++) {
            assets[i] = IAsset(_assets.at(i));
        }
    }
}
