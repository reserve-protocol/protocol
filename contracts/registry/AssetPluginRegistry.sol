// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { VersionRegistry } from "./VersionRegistry.sol";
import { RoleRegistry } from "./RoleRegistry.sol";

/**
 * @title Asset Plugin Registry
 * @notice A tiny contract for tracking asset plugins
 */
contract AssetPluginRegistry {
    VersionRegistry public versionRegistry;
    RoleRegistry public roleRegistry;
    // versionHash => asset => isValid
    mapping(bytes32 => mapping(address => bool)) private _isValidAsset;
    mapping(address => bool) public isDeprecated;

    error AssetPluginRegistry__InvalidAsset();
    error AssetPluginRegistry__InvalidCaller();
    error AssetPluginRegistry__InvalidVersion();
    error AssetPluginRegistry__LengthMismatch();

    event AssetPluginRegistryUpdated(bytes32 versionHash, address asset, bool validity);

    constructor(address _versionRegistry) {
        versionRegistry = VersionRegistry(_versionRegistry);
        roleRegistry = versionRegistry.roleRegistry();
    }

    function registerAsset(address _asset, bytes32[] calldata validForVersions) external {
        if (!roleRegistry.isOwner(msg.sender)) {
            revert AssetPluginRegistry__InvalidCaller();
        }
        if (_asset == address(0)) {
            revert AssetPluginRegistry__InvalidAsset();
        }

        for (uint256 i = 0; i < validForVersions.length; ++i) {
            bytes32 versionHash = validForVersions[i];
            if (address(versionRegistry.deployments(versionHash)) == address(0)) {
                revert AssetPluginRegistry__InvalidVersion();
            }

            _isValidAsset[versionHash][_asset] = true;

            emit AssetPluginRegistryUpdated(versionHash, _asset, true);
        }
    }

    function updateVersionsByAsset(
        address _asset,
        bytes32[] calldata _versionHashes,
        bool[] calldata _validities
    ) external {
        if (!roleRegistry.isOwner(msg.sender)) {
            revert AssetPluginRegistry__InvalidCaller();
        }
        if (_versionHashes.length != _validities.length) {
            revert AssetPluginRegistry__LengthMismatch();
        }

        if (_asset == address(0)) {
            revert AssetPluginRegistry__InvalidAsset();
        }

        for (uint256 i = 0; i < _versionHashes.length; ++i) {
            bytes32 versionHash = _versionHashes[i];
            if (address(versionRegistry.deployments(versionHash)) == address(0)) {
                revert AssetPluginRegistry__InvalidVersion();
            }

            _isValidAsset[versionHash][_asset] = _validities[i];

            emit AssetPluginRegistryUpdated(versionHash, _asset, _validities[i]);
        }
    }

    function updateAssetsByVersion(
        bytes32 _versionHash,
        address[] calldata _assets,
        bool[] calldata _validities
    ) external {
        if (!roleRegistry.isOwner(msg.sender)) {
            revert AssetPluginRegistry__InvalidCaller();
        }
        if (_assets.length != _validities.length) {
            revert AssetPluginRegistry__LengthMismatch();
        }

        if (address(versionRegistry.deployments(_versionHash)) == address(0)) {
            revert AssetPluginRegistry__InvalidVersion();
        }

        for (uint256 i = 0; i < _assets.length; ++i) {
            address asset = _assets[i];
            if (asset == address(0)) {
                revert AssetPluginRegistry__InvalidAsset();
            }

            _isValidAsset[_versionHash][asset] = _validities[i];

            emit AssetPluginRegistryUpdated(_versionHash, asset, _validities[i]);
        }
    }

    function deprecateAsset(address _asset) external {
        if (!roleRegistry.isOwnerOrEmergencyCouncil(msg.sender)) {
            revert AssetPluginRegistry__InvalidCaller();
        }

        isDeprecated[_asset] = true;
    }

    function isValidAsset(bytes32 _versionHash, address _asset) external view returns (bool) {
        if (!isDeprecated[_asset]) {
            return _isValidAsset[_versionHash][_asset];
        }

        return false;
    }
}
