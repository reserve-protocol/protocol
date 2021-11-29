// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "contracts/p0/interfaces/IAsset.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/main/Mixin.sol";

contract AssetRegistryP0 is Ownable, Mixin, IAssetRegistry {
    using EnumerableSet for EnumerableSet.AddressSet;

    EnumerableSet.AddressSet internal _alltimeCollateral;
    EnumerableSet.AddressSet internal _approvedCollateral;

    function init(ConstructorArgs calldata args) public virtual override {
        super.init(args);
        for (uint256 i = 0; i < args.approvedCollateral.length; i++) {
            _approveCollateral(args.approvedCollateral_[i]);
        }
    }

    /// @return fiatcoins An array of approved fiatcoin collateral to be used for oracle USD determination
    // TODO: make `fiatcoins` storage instead of memory
    function approvedFiatcoins() public view returns (ICollateral[] memory fiatcoins) {}

    function approveCollateral(ICollateral collateral) external onlyOwner {
        _approveCollateral(collateral);
    }

    function unapproveCollateral(ICollateral collateral) external onlyOwner {
        _unapproveCollateral(collateral);
    }

    function _approveCollateral(ICollateral collateral) internal {
        _approvedCollateral.add(address(collateral));
        _alltimeCollateral.add(address(collateral));
    }

    function _unapproveCollateral(ICollateral collateral) internal {
        _approvedCollateral.remove(address(collateral));
    }
}
