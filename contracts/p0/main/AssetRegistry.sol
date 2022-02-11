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

    function addAsset(IAsset asset) external onlyOwner {
        _assets.add(address(asset));
        emit AssetAdded(asset);
    }

    function removeAsset(IAsset asset) external onlyOwner {
        _assets.remove(address(asset));
        address token = address(asset.erc20());
        if (activeTokens.contains(token)) {
            delete _activeAssets[token];
            activeTokens.remove(token);
        }
        emit AssetRemoved(asset);
    }

    /// Activate `asset`
    /// Fails if its erc20 is not in the current basket
    function activateAsset(IAsset asset) external onlyOwner {
        address token = address(asset.erc20());
        require(!basketTokens.contains(token), "Token is in current basket");
        activeTokens.add(token);
        _activeAssets[token] = asset;
        // TODO: emit event
    }

    /// Deactive `asset`
    /// Fails if its erc20 is not in the current basket
    function deactivateAsset(IAsset asset) external onlyOwner {
        address token = address(asset.erc20());
        require(!basketTokens.contains(token), "Token is in current basket");
        activeTokens.remove(token);
        delete _activeAssets[token];
        // TODO: emit event
    }

    /// Configure basketTokens from a new basket
    /// Anything that changes the _currently active basket_ must call this!
    /// @param basket The newly-set basket
    function activateBasketAssets(Basket storage basket) internal {
        // Empty basketTokens
        while (basketTokens.length() > 0) {
            address token = basketTokens.at(basketTokens.length() - 1);
            delete _activeAssets[token];
            basketTokens.remove(token);
            activeTokens.remove(token);
        }

        // Read basket and write basketTokens and _assets
        for (uint256 i = 0; i < basket.size; i++) {
            IAsset asset = IAsset(basket.collateral[i]);
            address token = address(asset.erc20());
            activeTokens.add(token);
            basketTokens.add(token);
            _activeAssets[token] = asset;
        }
        // TODO: emit events
    }

    function activeAssets() external view override returns (IAsset[] memory assets) {
        assets = new IAsset[](activeTokens.length());
        for (uint256 i = 0; i < activeTokens.length(); i++) {
            assets[i] = _activeAssets[activeTokens.at(i)];
        }
    }
}
