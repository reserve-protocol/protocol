// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

contract AssetPluginRegistryMock {
    function isValidAsset(bytes32, address) public view returns (bool) {
        return true;
    }
}
