// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "contracts/p0/interfaces/IAsset.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/main/Mixin.sol";

contract AssetRegistryP0 is Ownable, Mixin, IAssetRegistry {
    using EnumerableSet for EnumerableSet.AddressSet;

    // All registered assets
    EnumerableSet.AddressSet internal _assets;

    // The ERC20 tokens for all active assets
    EnumerableSet.AddressSet private activeTokens;
    // The ERC20 tokens in the current basket
    EnumerableSet.AddressSet private basketTokens;
    // Invariant: basketTokens is subset of activeTokens

    // The active asset that models each erc20 address.
    // Invariant: _activeAssets[e] != 0 iff activeTokens.contains(e)
    mapping(address => IAsset) private _activeAssets;

    function init(ConstructorArgs calldata args) public virtual override {
        super.init(args);
    }

    function addAsset(IAsset asset) external onlyOwner returns (bool) {
        return _add(asset);
    }

    /// Remove `asset`, and deactivate it if needed.
    function removeAsset(IAsset asset) external onlyOwner returns (bool) {
        bool removed = _remove(asset);
        if (removed) _deactivate(asset);
        return removed;
    }

    /// Activate `asset`, and add it if needed
    /// Fail if its erc20 is in the current basket
    function activateAsset(IAsset asset) external onlyOwner returns (bool) {
        address token = address(asset.erc20());
        require(!basketTokens.contains(token), "Token is in current basket");
        _add(asset);
        return _activate(asset);
    }

    /// Deactivate `asset`, but do not remove it.
    /// Fail if its erc20 is in the current basket
    function deactivateAsset(IAsset asset) external onlyOwner returns (bool) {
        address token = address(asset.erc20());
        require(!basketTokens.contains(token), "Token is in current basket");
        return _deactivate(asset);
    }

    /// Configure basketTokens from a new basket
    /// Anything that changes the _currently active basket_ must call this!
    /// @param basket The newly-set basket
    function activateBasketAssets(Basket storage basket) internal {
        // Empty basketTokens
        while (basketTokens.length() > 0) {
            address token = basketTokens.at(basketTokens.length() - 1);
            _deactivate(_activeAssets[token]);
        }

        // Read basket and write basketTokens and _assets
        for (uint256 i = 0; i < basket.size; i++) {
            _activate(IAsset(basket.collateral[i]));
        }
    }

    function allAssets() external view override returns (IAsset[] memory assets) {
        assets = new IAsset[](_assets.length());
        for (uint256 i = 0; i < _assets.length(); i++) {
            assets[i] = IAsset(_assets.at(i));
        }
    }

    function activeAssets() external view override returns (IAsset[] memory assets) {
        assets = new IAsset[](activeTokens.length());
        for (uint256 i = 0; i < activeTokens.length(); i++) {
            assets[i] = _activeAssets[activeTokens.at(i)];
        }
    }

    // === private, permissionless, event-emitting mutators ====

    function _add(IAsset asset) private returns (bool) {
        bool added = _assets.add(address(asset));
        if (added) emit AssetAdded(asset);
        return added;
    }

    function _remove(IAsset asset) private returns (bool) {
        bool removed = _assets.remove(address(asset));
        if (removed) emit AssetRemoved(asset);
        return removed;
    }

    function _activate(IAsset asset) private returns (bool) {
        address token = address(asset.erc20());
        bool setAsset = _activeAssets[token] != asset;

        activeTokens.add(token);

        if (setAsset) {
            _activeAssets[token] = asset;
            emit AssetActivated(asset);
        }
        return setAsset;
    }

    function _deactivate(IAsset asset) private returns (bool) {
        address token = address(asset.erc20());
        bool unsetAsset = _activeAssets[token] == asset;

        if (unsetAsset) {
            delete _activeAssets[token];
            activeTokens.remove(token);
            basketTokens.remove(token);
            emit AssetDeactivated(asset);
        }
        return unsetAsset;
    }
}
