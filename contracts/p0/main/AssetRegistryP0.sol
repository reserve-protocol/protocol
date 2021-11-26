// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity ^0.8.9;

import "contracts/Ownable.sol"; // temporary

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "contracts/p0/interfaces/IAsset.sol";
import "contracts/p0/interfaces/IAssetManager.sol";

contract AssetRegistryP0 is Ownable {
    using EnumerableSet for EnumerableSet.AddressSet;

    EnumerableSet.AddressSet internal _alltimeCollateral;
    EnumerableSet.AddressSet internal _approvedCollateral;
    EnumerableSet.AddressSet internal _fiatcoins;

    /// @return fiatcoins An array of approved fiatcoin collateral to be used for oracle USD determination
    // TODO: make `fiatcoins` storage instead of memory
    function approvedFiatcoins() public view returns (ICollateral[] memory fiatcoins) {
        address[] memory addresses = _fiatcoins.values();
        fiatcoins = new ICollateral[](addresses.length);
        for (uint256 i = 0; i < addresses.length; i++) {
            fiatcoins[i] = ICollateral(addresses[i]);
        }
    }

    function approveCollateral(ICollateral collateral) external onlyOwner {
        _approveCollateral(collateral);
    }
    function unapproveCollateral(ICollateral collateral) external onlyOwner {
        _unapproveCollateral(collateral);
    }

    function _approveCollateral(ICollateral collateral) internal {
        _approvedCollateral.add(address(collateral));
        _alltimeCollateral.add(address(collateral));
        if (collateral.isFiatcoin()) {
            _fiatcoins.add(address(collateral));
        }
    }

    function _unapproveCollateral(ICollateral collateral) internal {
        _approvedCollateral.remove(address(collateral));
        if (collateral.isFiatcoin()) {
            _fiatcoins.remove(address(collateral));
        }
    }

}
