// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "../interfaces/IAssetRegistry.sol";
import "../interfaces/IMain.sol";
import "./mixins/Component.sol";

/// The AssetRegistry provides the mapping from ERC20 to Asset, allowing the rest of Main
/// to think in terms of ERC20 tokens and target/ref units.
contract AssetRegistryP1 is ComponentP1, IAssetRegistry {
    using EnumerableSet for EnumerableSet.AddressSet;

    uint256 public constant GAS_FOR_BH_QTY = 100_000; // enough to call bh.quantity
    uint256 public constant GAS_FOR_DISABLE_BASKET = 900_000; // enough to disable basket on n=128

    // Peer-component addresses
    IBasketHandler private basketHandler;
    IBackingManager private backingManager;

    // Registered ERC20s
    EnumerableSet.AddressSet private _erc20s;

    // Registered Assets
    mapping(IERC20 => IAsset) private assets;

    // === 3.0.0 ===

    uint48 public lastRefresh; // {s}

    /* ==== Contract Invariants ====
       The contract state is just the mapping assets; _erc20s is ignored in properties.

       invariant: _erc20s == keys(assets)
       invariant: addr == assets[addr].erc20()
           where: addr in assets
     */

    /// Initialize the AssetRegistry with assets
    // effects: assets' = {a.erc20(): a for a in assets_}
    function init(IMain main_, IAsset[] calldata assets_) external initializer {
        __Component_init(main_);
        basketHandler = main_.basketHandler();
        backingManager = main_.backingManager();

        uint256 length = assets_.length;
        for (uint256 i = 0; i < length; ++i) {
            _register(assets_[i]);
        }
    }

    /// Update the state of all assets
    /// @custom:refresher
    // actions:
    //   calls refresh(c) for c in keys(assets) when c.isCollateral()
    //   tracks basket status on basketHandler
    function refresh() public {
        // It's a waste of gas to require notPausedOrFrozen because assets can be updated directly
        // Assuming an RTokenAsset is registered, furnace.melt() will also be called

        uint256 length = _erc20s.length();
        for (uint256 i = 0; i < length; ++i) {
            assets[IERC20(_erc20s.at(i))].refresh();
        }

        basketHandler.trackStatus();
        lastRefresh = uint48(block.timestamp); // safer to do this at end than start, actually
    }

    /// Register `asset`
    /// If either the erc20 address or the asset was already registered, fail
    /// @return true if the erc20 address was not already registered.
    /// @custom:governance
    // checks: asset.erc20() not in keys(assets) or assets[asset.erc20] == asset
    // effects: assets' = assets.set(asset.erc20(), asset)
    // returns: (asset.erc20 not in keys(assets))
    function register(IAsset asset) external governance returns (bool) {
        return _register(asset);
    }

    /// Register `asset` if and only if its erc20 address is already registered.
    /// If the erc20 address was not registered, revert.
    /// @return swapped If the asset was swapped for a previously-registered asset
    /// @custom:governance
    // contract
    // checks: asset.erc20() in assets
    // effects: assets' = assets + {asset.erc20(): asset}
    // actions: if asset.erc20() is in basketHandler's basket then basketHandler.disableBasket()
    function swapRegistered(IAsset asset) external governance returns (bool swapped) {
        require(_erc20s.contains(address(asset.erc20())), "no ERC20 collision");

        try basketHandler.quantity{ gas: _reserveGas() }(asset.erc20()) returns (uint192 quantity) {
            if (quantity != 0) basketHandler.disableBasket(); // not an interaction
        } catch {
            basketHandler.disableBasket();
        }

        swapped = _registerIgnoringCollisions(asset);
    }

    /// Unregister an asset, requiring that it is already registered
    /// Rewards are NOT claimed by default when unregistering due to security concerns.
    /// If the collateral is secure, governance should claim rewards before unregistering.
    /// @custom:governance
    // checks: assets[asset.erc20()] == asset
    // effects: assets' = assets - {asset.erc20():_} + {asset.erc20(), asset}
    function unregister(IAsset asset) external governance {
        require(_erc20s.contains(address(asset.erc20())), "no asset to unregister");
        require(assets[asset.erc20()] == asset, "asset not found");

        try basketHandler.quantity{ gas: _reserveGas() }(asset.erc20()) returns (uint192 quantity) {
            if (quantity != 0) basketHandler.disableBasket(); // not an interaction
        } catch {
            basketHandler.disableBasket();
        }

        _erc20s.remove(address(asset.erc20()));
        assets[asset.erc20()] = IAsset(address(0));
        emit AssetUnregistered(asset.erc20(), asset);
    }

    /// Return the Asset registered for erc20; revert if erc20 is not registered.
    // checks: erc20 in assets
    // returns: assets[erc20]
    function toAsset(IERC20 erc20) external view returns (IAsset) {
        require(_erc20s.contains(address(erc20)), "erc20 unregistered");
        return assets[erc20];
    }

    /// Return the Collateral registered for erc20; revert if erc20 is not registered as Collateral
    // checks: erc20 in assets, assets[erc20].isCollateral()
    // returns: assets[erc20]
    function toColl(IERC20 erc20) external view returns (ICollateral) {
        require(_erc20s.contains(address(erc20)), "erc20 unregistered");
        require(assets[erc20].isCollateral(), "erc20 is not collateral");
        return ICollateral(address(assets[erc20]));
    }

    /// Returns true if erc20 is registered.
    // returns: (erc20 in assets)
    function isRegistered(IERC20 erc20) external view returns (bool) {
        return _erc20s.contains(address(erc20));
    }

    /// Returns keys(assets) as a (duplicate-free) list.
    // returns: [keys(assets)] without duplicates.
    function erc20s() external view returns (IERC20[] memory erc20s_) {
        uint256 length = _erc20s.length();
        erc20s_ = new IERC20[](length);
        for (uint256 i = 0; i < length; ++i) {
            erc20s_[i] = IERC20(_erc20s.at(i));
        }
    }

    /// Returns keys(assets), values(assets) as (duplicate-free) lists.
    // returns: [keys(assets)], [values(assets)] without duplicates.
    /// @return reg The list of registered ERC20s and Assets, in the same order
    function getRegistry() public view returns (Registry memory reg) {
        uint256 length = _erc20s.length();
        reg.erc20s = new IERC20[](length);
        reg.assets = new IAsset[](length);
        for (uint256 i = 0; i < length; ++i) {
            reg.erc20s[i] = IERC20(_erc20s.at(i));
            reg.assets[i] = assets[IERC20(_erc20s.at(i))];
        }
    }

    /// @inheritdoc IAssetRegistry
    function validateCurrentAssets() external view {
        Registry memory registry = getRegistry();
        AssetPluginRegistry assetPluginRegistry = main.assetPluginRegistry();

        if (address(assetPluginRegistry) != address(0)) {
            uint256 assetLen = registry.assets.length;
            for (uint256 i = 0; i < assetLen; ++i) {
                IAsset asset = registry.assets[i];

                require(
                    assetPluginRegistry.isValidAsset(
                        keccak256(abi.encodePacked(this.version())),
                        address(asset)
                    ),
                    "unsupported asset"
                );
            }
        }
    }

    /// @return The number of registered ERC20s
    function size() external view returns (uint256) {
        return _erc20s.length();
    }

    /// Register an asset
    /// Forbids registering a different asset for an ERC20 that is already registered
    /// @return registered If the asset was moved from unregistered to registered
    // checks: (asset.erc20() not in assets) or (assets[asset.erc20()] == asset)
    // effects: assets' = assets.set(asset.erc20(), asset)
    // returns: assets.erc20() not in assets
    function _register(IAsset asset) internal returns (bool registered) {
        require(
            !_erc20s.contains(address(asset.erc20())) || assets[asset.erc20()] == asset,
            "duplicate ERC20 detected"
        );

        registered = _registerIgnoringCollisions(asset);
    }

    /// Register an asset, unregistering any previous asset with the same ERC20.
    // effects: assets' = assets.set(asset.erc20(), asset)
    // returns: assets[asset.erc20()] != asset
    function _registerIgnoringCollisions(IAsset asset) private returns (bool swapped) {
        if (asset.isCollateral()) {
            require(
                ICollateral(address(asset)).status() == CollateralStatus.SOUND,
                "collateral not sound"
            );
        }

        AssetPluginRegistry assetPluginRegistry = main.assetPluginRegistry();
        if (address(assetPluginRegistry) != address(0)) {
            require(
                main.assetPluginRegistry().isValidAsset(
                    keccak256(abi.encodePacked(this.version())),
                    address(asset)
                ),
                "unsupported asset"
            );
        }

        IERC20Metadata erc20 = asset.erc20();
        if (_erc20s.contains(address(erc20))) {
            if (assets[erc20] == asset) return false;
            else emit AssetUnregistered(erc20, assets[erc20]);
        } else {
            _erc20s.add(address(erc20));
        }

        assets[erc20] = asset;
        emit AssetRegistered(erc20, asset);

        // Refresh to ensure it does not revert, and to save a recent lastPrice
        asset.refresh();

        if (!main.frozen()) {
            backingManager.grantRTokenAllowance(erc20);
        }

        return true;
    }

    function _reserveGas() private view returns (uint256) {
        uint256 gas = gasleft();
        // Call to quantity() restricts gas that is passed along to 63 / 64 of gasleft().
        // Therefore gasleft() must be greater than 64 * GAS_FOR_BH_QTY / 63
        // GAS_FOR_DISABLE_BASKET is a buffer which can be considerably lower without
        // security implications.
        require(
            gas > (64 * GAS_FOR_BH_QTY) / 63 + GAS_FOR_DISABLE_BASKET,
            "not enough gas to unregister safely"
        );
        return GAS_FOR_BH_QTY;
    }

    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
     *
     * AssetRegistry uses 52 slots, not 50.
     */
    uint256[46] private __gap;
}
