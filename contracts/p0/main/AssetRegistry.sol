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
    EnumerableSet.AddressSet internal assets;

    // The ERC20 tokens for all active assets
    EnumerableSet.AddressSet private activeTokens;
    // The ERC20 tokens in the current basket
    EnumerableSet.AddressSet private basketTokens;
    // Invariant: basketTokens is subset of activeTokens

    // The active asset that models each erc20 address.
    // Invariant: activeAssets[e] != 0 iff activeTokens.contains(e)
    mapping(address => IAsset) internal activeAssets;

    function init(ConstructorArgs calldata args) public virtual override {
        super.init(args);
    }

    function addAsset(IAsset asset) external onlyOwner {
        _assets.add(address(asset));
        emit AssetAdded(asset);
    }

    function removeAsset(IAsset asset) external onlyOwner {
        _assets.remove(address(asset));
        if (activeTokens.contains(asset.erc20())) {
            delete _activeAssets[asset.erc20()];
            activeTokens.remove(asset.erc20());
        }
        emit AssetRemoved(asset);
    }

    /// Activate `asset`
    /// Fails if its erc20 is not in the current basket
    function activateAsset(IAsset asset) external onlyOwner {
        address token = asset.erc20();
        require(!_basketTokens.contains(token), "Token is in current basket");
        activeTokens.add(token);
        _activeAssets[token] = asset;
        // TODO: emit event
    }

    /// Deactive `asset`
    /// Fails if its erc20 is not in the current basket
    function deactivateAsset(IAsset asset) external onlyOwner {
        address token = asset.erc20();
        require(!_basketTokens.contains(token), "Token is in current basket");
        activeTokens.remove(token);
        delete _activeAssets[token];
        // TODO: emit event
    }

    /// Configure _basketTokens from a new basket
    /// Anything that changes the _currently active basket_ must call this!
    /// @param basket The newly-set basket
    function activateBasketAssets(Basket storage basket) internal {
        // Empty _basketTokens
        while (_basketTokens.length() > 0) {
            address token = _basketTokens.at(_basketTokens.length() - 1);
            delete _activeAssets[token];
            _basketTokens.remove(token);
            activeTokens.remove(token);
        }

        // Read basket and write _basketTokens and _assets
        for (uint256 i = 0; i < basket.size; i++) {
            IAsset asset = IAsset(basket.collateral[i]);
            address token = asset.erc20();
            activeTokens.add(token);
            _basketTokens.add(token);
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
