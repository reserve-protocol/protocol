// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "../../interfaces/IVersioned.sol";

// This value should be updated on each release
string constant ASSET_VERSION = "4.0.0";

/**
 * @title VersionedAsset
 * @notice A mix-in to track semantic versioning uniformly across asset plugin contracts.
 */
abstract contract VersionedAsset is IVersioned {
    function version() public pure virtual override returns (string memory) {
        return ASSET_VERSION;
    }
}
