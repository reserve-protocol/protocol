// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "contracts/p0/Component.sol";
import "contracts/p0/interfaces/IMain.sol";

/// The AssetRegistry provides the mapping from ERC20 to Asset, allowing the rest of Main
/// to think in terms of ERC20 tokens and target/ref units.
contract AssetRegistryP0 is Component, IAssetRegistry {
    using EnumerableSet for EnumerableSet.AddressSet;

    // Registered ERC20s
    EnumerableSet.AddressSet private erc20s;

    // Registered Assets
    mapping(IERC20Metadata => IAsset) private assets;

    function init(ConstructorArgs calldata args) internal virtual override {
        for (uint256 i = 0; i < args.assets.length; i++) _registerAsset(args.assets[i]);
    }

    /// Forbids registering a different asset for an ERC20 that is already registered
    /// @return If the asset was moved from unregistered to registered
    function registerAsset(IAsset asset) external onlyOwner returns (bool) {
        return _registerAsset(asset);
    }

    /// Swap an asset that shares an ERC20 with a presently-registered asset, de-registering it
    /// Fails if there is not an asset already registered for the ERC20
    /// @return If the asset was swapped for a previously-registered asset
    function swapRegisteredAsset(IAsset asset) external onlyOwner returns (bool) {
        require(erc20s.contains(address(asset.erc20())), "no ERC20 collision");
        assert(assets[asset.erc20()] != IAsset(address(0)));
        return _registerAssetIgnoringCollisions(asset);
    }

    /// Unregister an asset, requiring that it is already registered
    function unregisterAsset(IAsset asset) external onlyOwner {
        require(erc20s.contains(address(asset.erc20())), "no asset to unregister");
        require(assets[asset.erc20()] == asset, "asset not found");
        erc20s.remove(address(asset.erc20()));
        assets[asset.erc20()] = IAsset(address(0));
        emit AssetUnregistered(asset.erc20(), asset);
    }

    /// Return the Asset modelling this ERC20, or revert
    function toAsset(IERC20Metadata erc20) external view override returns (IAsset) {
        require(erc20s.contains(address(erc20)), "erc20 unregistered");
        assert(assets[erc20] != IAsset(address(0)));
        return assets[erc20];
    }

    /// Return the Collateral modelling this ERC20, or revert
    function toColl(IERC20Metadata erc20) external view override returns (ICollateral) {
        require(erc20s.contains(address(erc20)), "erc20 unregistered");
        assert(assets[erc20] != IAsset(address(0)));
        require(assets[erc20].isCollateral(), "erc20 is not collateral");
        return ICollateral(address(assets[erc20]));
    }

    function isRegistered(IERC20Metadata erc20) external view override returns (bool) {
        return erc20s.contains(address(erc20));
    }

    function registeredERC20s() external view override returns (IERC20Metadata[] memory erc20s_) {
        erc20s_ = new IERC20Metadata[](erc20s.length());
        for (uint256 i = 0; i < erc20s.length(); i++) {
            erc20s_[i] = IERC20Metadata(erc20s.at(i));
        }
    }

    //

    /// Forbids registering a different asset for an ERC20 that is already registered
    /// @return If the asset was moved from unregistered to registered
    function _registerAsset(IAsset asset) internal returns (bool) {
        require(
            !erc20s.contains(address(asset.erc20())) || assets[asset.erc20()] == asset,
            "duplicate ERC20 detected"
        );
        return _registerAssetIgnoringCollisions(asset);
    }

    /// Register an asset, unregistering any previous asset with the same ERC20.
    function _registerAssetIgnoringCollisions(IAsset asset) private returns (bool swapped) {
        if (erc20s.contains(address(asset.erc20())) && assets[asset.erc20()] == asset) return false;

        if (erc20s.contains(address(asset.erc20())) && assets[asset.erc20()] != asset) {
            erc20s.remove(address(asset.erc20()));
            emit AssetUnregistered(asset.erc20(), assets[asset.erc20()]);
        }

        swapped = erc20s.add(address(asset.erc20()));
        assets[asset.erc20()] = asset;
        emit AssetRegistered(asset.erc20(), asset);
    }
}
