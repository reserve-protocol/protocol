// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "contracts/interfaces/IMain.sol";
import "contracts/p0/mixins/Component.sol";

/// The AssetRegistry provides the mapping from ERC20 to Asset, allowing the rest of Main
/// to think in terms of ERC20 tokens and target/ref units.
contract AssetRegistryP0 is ComponentP0, IAssetRegistry {
    using FixLib for uint192;
    using EnumerableSet for EnumerableSet.AddressSet;

    // Registered ERC20s
    EnumerableSet.AddressSet private _erc20s;

    // Registered Assets
    mapping(IERC20 => IAsset) private assets;

    function init(IMain main_, IAsset[] memory assets_) public initializer {
        __Component_init(main_);
        for (uint256 i = 0; i < assets_.length; i++) {
            _register(assets_[i]);
        }
    }

    /// Force updates in all collateral assets
    /// @custom:refresher
    function refresh() external {
        // It's a waste of gas to require notPausedOrFrozen because assets can be updated directly
        for (uint256 i = 0; i < _erc20s.length(); i++) {
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
        assert(assets[asset.erc20()] != IAsset(address(0)));
        uint192 quantity = main.basketHandler().quantity(asset.erc20());

        swapped = _registerIgnoringCollisions(asset);

        if (quantity.gt(FIX_ZERO)) main.basketHandler().disableBasket();
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

        if (quantity.gt(FIX_ZERO)) main.basketHandler().disableBasket();
    }

    /// Return the Asset modelling this ERC20, or revert
    function toAsset(IERC20 erc20) external view returns (IAsset) {
        require(_erc20s.contains(address(erc20)), "erc20 unregistered");
        assert(assets[erc20] != IAsset(address(0)));
        return assets[erc20];
    }

    /// Return the Collateral modelling this ERC20, or revert
    function toColl(IERC20 erc20) external view returns (ICollateral) {
        require(_erc20s.contains(address(erc20)), "erc20 unregistered");
        assert(assets[erc20] != IAsset(address(0)));
        require(assets[erc20].isCollateral(), "erc20 is not collateral");
        return ICollateral(address(assets[erc20]));
    }

    function isRegistered(IERC20 erc20) external view returns (bool) {
        return _erc20s.contains(address(erc20));
    }

    function erc20s() external view returns (IERC20[] memory erc20s_) {
        erc20s_ = new IERC20[](_erc20s.length());
        for (uint256 i = 0; i < _erc20s.length(); i++) {
            erc20s_[i] = IERC20(_erc20s.at(i));
        }
    }

    /// TODO decide whether to keep and use it in more places, or dump
    function getRegistry()
        external
        view
        returns (IERC20[] memory erc20s_, IAsset[] memory assets_)
    {
        uint256 length = _erc20s.length();
        erc20s_ = new IERC20[](length);
        assets_ = new IAsset[](length);
        for (uint256 i = 0; i < length; ++i) {
            erc20s_[i] = IERC20(_erc20s.at(i));
            assets_[i] = assets[IERC20(_erc20s.at(i))];
            assert(address(erc20s_[i]) != address(0));
            assert(address(assets_[i]) != address(0));
        }
        assert(erc20s_.length == assets_.length);
    }

    //

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
        if (_erc20s.contains(address(asset.erc20())) && assets[asset.erc20()] == asset)
            return false;

        if (_erc20s.contains(address(asset.erc20())) && assets[asset.erc20()] != asset) {
            _erc20s.remove(address(asset.erc20()));
            emit AssetUnregistered(asset.erc20(), assets[asset.erc20()]);
        }

        swapped = _erc20s.add(address(asset.erc20()));
        assets[asset.erc20()] = asset;
        emit AssetRegistered(asset.erc20(), asset);
    }
}
