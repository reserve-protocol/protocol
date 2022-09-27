// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "contracts/interfaces/IAssetRegistry.sol";
import "contracts/interfaces/IMain.sol";
import "contracts/p1/mixins/Component.sol";

/// The AssetRegistry provides the mapping from ERC20 to Asset, allowing the rest of Main
/// to think in terms of ERC20 tokens and target/ref units.
contract AssetRegistryP1 is ComponentP1, IAssetRegistry {
    using EnumerableSet for EnumerableSet.AddressSet;

    // Registered ERC20s
    EnumerableSet.AddressSet internal _erc20s;

    // Registered Assets
    mapping(IERC20 => IAsset) internal assets;

    function init(IMain main_, IAsset[] calldata assets_) external initializer {
        __Component_init(main_);
        uint256 length = assets_.length;
        for (uint256 i = 0; i < length; ++i) {
            _register(assets_[i]);
        }
    }

    /// Update the state of all assets
    /// @custom:refresher
    function refresh() external {
        // It's a waste of gas to require notPausedOrFrozen because assets can be updated directly
        uint256 length = _erc20s.length();
        for (uint256 i = 0; i < length; ++i) {
            IAsset asset = assets[IERC20(_erc20s.at(i))];
            if (asset.isCollateral()) ICollateral(address(asset)).refresh();
        }
    }

    /// Forbids registering a different asset for an ERC20 that is already registered
    /// @return If the asset was moved from unregistered to registered
    /// @custom:governance
    function register(IAsset asset) external governance returns (bool) {
        return _register(asset);
    }

    /// Swap an asset that shares an ERC20 with a presently-registered asset, de-registering it
    /// Fails if there is not an asset already registered for the ERC20
    /// @return swapped If the asset was swapped for a previously-registered asset
    /// @custom:governance
    function swapRegistered(IAsset asset) external governance returns (bool swapped) {
        require(_erc20s.contains(address(asset.erc20())), "no ERC20 collision");

        uint192 quantity = main.basketHandler().quantity(asset.erc20());

        swapped = _registerIgnoringCollisions(asset);

        if (quantity > 0) main.basketHandler().disableBasket();
    }

    /// Unregister an asset, requiring that it is already registered
    /// @custom:governance
    function unregister(IAsset asset) external governance {
        require(_erc20s.contains(address(asset.erc20())), "no asset to unregister");
        require(assets[asset.erc20()] == asset, "asset not found");
        uint192 quantity = main.basketHandler().quantity(asset.erc20());

        _erc20s.remove(address(asset.erc20()));
        assets[asset.erc20()] = IAsset(address(0));
        emit AssetUnregistered(asset.erc20(), asset);

        if (quantity > 0) main.basketHandler().disableBasket();
    }

    /// Return the Asset modelling this ERC20, or revert
    function toAsset(IERC20 erc20) external view returns (IAsset) {
        require(_erc20s.contains(address(erc20)), "erc20 unregistered");
        return assets[erc20];
    }

    /// Return the Collateral modelling this ERC20, or revert
    function toColl(IERC20 erc20) external view returns (ICollateral) {
        require(_erc20s.contains(address(erc20)), "erc20 unregistered");
        require(assets[erc20].isCollateral(), "erc20 is not collateral");
        return ICollateral(address(assets[erc20]));
    }

    function isRegistered(IERC20 erc20) external view returns (bool) {
        return _erc20s.contains(address(erc20));
    }

    function erc20s() external view returns (IERC20[] memory erc20s_) {
        uint256 length = _erc20s.length();
        erc20s_ = new IERC20[](length);
        for (uint256 i = 0; i < length; ++i) {
            erc20s_[i] = IERC20(_erc20s.at(i));
        }
    }

    /// Forbids registering a different asset for an ERC20 that is already registered
    /// @return registered If the asset was moved from unregistered to registered
    function _register(IAsset asset) internal returns (bool registered) {
        require(
            !_erc20s.contains(address(asset.erc20())) || assets[asset.erc20()] == asset,
            "duplicate ERC20 detected"
        );

        registered = _registerIgnoringCollisions(asset);
    }

    /// Register an asset, unregistering any previous asset with the same ERC20.
    function _registerIgnoringCollisions(IAsset asset) private returns (bool swapped) {
        IERC20Metadata erc20 = asset.erc20();
        if (_erc20s.contains(address(erc20)) && assets[erc20] == asset) return false;

        if (_erc20s.contains(address(erc20)) && assets[erc20] != asset) {
            _erc20s.remove(address(erc20));
            emit AssetUnregistered(erc20, assets[erc20]);
        }

        swapped = _erc20s.add(address(erc20));
        assets[erc20] = asset;
        emit AssetRegistered(erc20, asset);
    }
}
