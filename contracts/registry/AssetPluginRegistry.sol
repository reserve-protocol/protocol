// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { VersionRegistry } from "./VersionRegistry.sol";

/**
 * @title Asset Plugin Registry
 * @notice A tiny contract for tracking asset plugins
 */
contract AssetPluginRegistry is Ownable {
    VersionRegistry public versionRegistry;
    // versionHash => asset => isValid
    mapping(bytes32 => mapping(address => bool)) public isValidAsset;

    constructor(address _versionRegistry) Ownable() {
        versionRegistry = VersionRegistry(_versionRegistry);

        _transferOwnership(versionRegistry.owner());
    }

    function registerAsset(address _asset, bytes32[] calldata validForVersions) external onlyOwner {
        for (uint256 i = 0; i < validForVersions.length; ++i) {
            bytes32 versionHash = validForVersions[i];
            require(
                address(versionRegistry.deployments(versionHash)) != address(0),
                "invalid version"
            );

            isValidAsset[versionHash][_asset] = true;
        }
    }

    function updateVersionsByAsset(
        address _asset,
        bytes32[] calldata _versionHashes,
        bool[] calldata _validities
    ) external onlyOwner {
        require(_versionHashes.length == _validities.length, "length mismatch");

        for (uint256 i = 0; i < _versionHashes.length; ++i) {
            bytes32 versionHash = _versionHashes[i];
            require(
                address(versionRegistry.deployments(versionHash)) != address(0),
                "invalid version"
            );

            isValidAsset[versionHash][_asset] = _validities[i];
        }
    }

    function updateAssetsByVersion(
        bytes32 _versionHash,
        address[] calldata _assets,
        bool[] calldata _validities
    ) external onlyOwner {
        require(_assets.length == _validities.length, "length mismatch");
        require(
            address(versionRegistry.deployments(_versionHash)) != address(0),
            "invalid version"
        );

        for (uint256 i = 0; i < _assets.length; ++i) {
            address asset = _assets[i];
            require(asset != address(0), "invalid asset");

            isValidAsset[_versionHash][asset] = _validities[i];
        }
    }
}
