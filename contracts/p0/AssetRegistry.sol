// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "../interfaces/IMain.sol";
import "./mixins/Component.sol";

/// The AssetRegistry provides the mapping from ERC20 to Asset, allowing the rest of Main
/// to think in terms of ERC20 tokens and target/ref units.
contract AssetRegistryP0 is ComponentP0, IAssetRegistry {
    using FixLib for uint192;
    using EnumerableSet for EnumerableSet.AddressSet;

    uint256 public constant GAS_FOR_BH_QTY = 100_000; // enough to call bh.quantity
    uint256 public constant GAS_FOR_DISABLE_BASKET = 900_000; // enough to disable basket on n=128

    // Registered ERC20s
    EnumerableSet.AddressSet private _erc20s;

    // Registered Assets
    mapping(IERC20 => IAsset) private assets;

    uint48 public lastRefresh; // {s}

    function init(IMain main_, IAsset[] memory assets_) public initializer {
        __Component_init(main_);
        for (uint256 i = 0; i < assets_.length; i++) {
            _register(assets_[i]);
        }
    }

    /// Force updates in all collateral assets. Track basket status.
    /// @custom:refresher
    function refresh() public {
        // It's a waste of gas to require notPausedOrFrozen because assets can be updated directly
        for (uint256 i = 0; i < _erc20s.length(); i++) {
            assets[IERC20(_erc20s.at(i))].refresh();
        }

        main.basketHandler().trackStatus();
        lastRefresh = uint48(block.timestamp);
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

        IBasketHandler basketHandler = main.basketHandler();
        try basketHandler.quantity{ gas: _reserveGas() }(asset.erc20()) returns (uint192 quantity) {
            if (quantity.gt(0)) basketHandler.disableBasket(); // not an interaction
        } catch {
            basketHandler.disableBasket();
        }

        swapped = _registerIgnoringCollisions(asset);
    }

    /// Unregister an asset, requiring that it is already registered
    /// @custom:governance
    function unregister(IAsset asset) external governance {
        require(_erc20s.contains(address(asset.erc20())), "no asset to unregister");
        require(assets[asset.erc20()] == asset, "asset not found");

        IBasketHandler basketHandler = main.basketHandler();
        try basketHandler.quantity{ gas: _reserveGas() }(asset.erc20()) returns (uint192 quantity) {
            if (quantity.gt(0)) basketHandler.disableBasket(); // not an interaction
        } catch {
            basketHandler.disableBasket();
        }

        _erc20s.remove(address(asset.erc20()));
        assets[asset.erc20()] = IAsset(address(0));
        emit AssetUnregistered(asset.erc20(), asset);
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

    /// @return reg The list of registered ERC20s and Assets, in the same order
    function getRegistry() external view returns (Registry memory reg) {
        uint256 length = _erc20s.length();
        reg.erc20s = new IERC20[](length);
        reg.assets = new IAsset[](length);
        for (uint256 i = 0; i < length; ++i) {
            reg.erc20s[i] = IERC20(_erc20s.at(i));
            reg.assets[i] = assets[IERC20(_erc20s.at(i))];
            assert(address(reg.erc20s[i]) != address(0));
            assert(address(reg.assets[i]) != address(0));
        }
        assert(reg.erc20s.length == reg.assets.length);
    }

    function validateCurrentAssets() external view {}

    /// @return The number of registered ERC20s
    function size() external view returns (uint256) {
        return _erc20s.length();
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
        if (asset.isCollateral()) {
            require(
                ICollateral(address(asset)).status() == CollateralStatus.SOUND,
                "collateral not sound"
            );
        }

        if (_erc20s.contains(address(asset.erc20())) && assets[asset.erc20()] == asset)
            return false;

        // Refresh to ensure it does not revert, and to save a recent lastPrice
        asset.refresh();

        if (_erc20s.contains(address(asset.erc20())) && assets[asset.erc20()] != asset) {
            _erc20s.remove(address(asset.erc20()));
            emit AssetUnregistered(asset.erc20(), assets[asset.erc20()]);
        }

        swapped = _erc20s.add(address(asset.erc20()));
        assets[asset.erc20()] = asset;

        if (!main.frozen()) {
            main.backingManager().grantRTokenAllowance(asset.erc20());
        }
        emit AssetRegistered(asset.erc20(), asset);
    }

    function _reserveGas() private view returns (uint256) {
        uint256 gas = gasleft();
        require(
            gas > (64 * GAS_FOR_BH_QTY) / 63 + GAS_FOR_DISABLE_BASKET,
            "not enough gas to unregister safely"
        );
        return GAS_FOR_BH_QTY;
    }
}
