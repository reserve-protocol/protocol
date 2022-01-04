// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "contracts/p0/interfaces/IAsset.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/main/Mixin.sol";

contract AssetRegistryP0 is Ownable, Mixin, IAssetRegistry {
    using EnumerableSet for EnumerableSet.AddressSet;

    EnumerableSet.AddressSet internal _allAssets;

    // TODO: eliminate
    EnumerableSet.AddressSet internal _approvedCollateral;

    function init(ConstructorArgs calldata args) public virtual override {
        super.init(args);
        for (uint256 i = 0; i < args.approvedCollateral.length; i++) {
            _approveCollateral(args.approvedCollateral[i]);
        }
    }

    function beforeUpdate() public virtual override {
        super.beforeUpdate();
    }

    /// @return fiatcoins An array of approved fiatcoin collateral to be used for oracle USD determination
    function approvedFiatcoins() public view returns (ICollateral[] memory fiatcoins) {
        address[] memory addresses = _approvedCollateral.values();
        uint256 size;
        for (uint256 i = 0; i < addresses.length; i++) {
            if (ICollateral(addresses[i]).isFiatcoin()) {
                size++;
            }
        }
        fiatcoins = new ICollateral[](size);
        size = 0;
        for (uint256 i = 0; i < addresses.length; i++) {
            if (ICollateral(addresses[i]).isFiatcoin()) {
                fiatcoins[size] = ICollateral(addresses[i]);
                size++;
            }
        }
    }

    // todo: remove
    function approveCollateral(ICollateral collateral) external onlyOwner {
        _approveCollateral(collateral);
    }

    // TODO: remove
    function unapproveCollateral(ICollateral collateral) external onlyOwner {
        _unapproveCollateral(collateral);
    }

    function _approveCollateral(ICollateral collateral) internal {
        _approvedCollateral.add(address(collateral));
        _allAssets.add(address(collateral));
    }

    function _unapproveCollateral(ICollateral collateral) internal {
        _approvedCollateral.remove(address(collateral));
    }

    function allAssets() external view override returns (IAsset[] memory assets) {
        assets = new IAsset[](_allAssets.length());
        for (uint256 i = 0; i < _allAssets.length(); i++) {
            assets[i] = IAsset(_allAssets.at(i));
        }
    }

    function isApproved(IAsset asset) external view override returns (bool) {
        return _approvedCollateral.contains(address(asset));
    }
}
