// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/p0/DeployerP0.sol";
import "contracts/p0/interfaces/IAsset.sol";
import "contracts/p0/interfaces/IMarket.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/interfaces/IRToken.sol";
import "contracts/p0/interfaces/IStRSR.sol";
import "contracts/test/Mixins.sol";
import "./AssetManagerExtension.sol";
import "./FurnaceExtension.sol";
import "./MainExtension.sol";
import "./RTokenExtension.sol";
import "./StRSRExtension.sol";

/// Inject wrapper contracts into Deployer
contract DeployerExtension is IExtension, DeployerP0 {
    address internal _admin;
    IMain internal _main;

    constructor(
        IAsset rsr_,
        IAsset comp_,
        IAsset aave_,
        IMarket market_
    ) DeployerP0(rsr_, comp_, aave_, market_) {
        _admin = msg.sender;
    }

    function assertInvariants() external override {
        INVARIANT_currentDeploymentRegistered();
    }

    function _deployMain(Oracle.Info memory oracle, Config memory config) internal override returns (IMain) {
        _main = new MainExtension(_admin, oracle, config);
        return _main;
    }

    function _deployFurnace(address rToken) internal override returns (IFurnace) {
        return new FurnaceExtension(_admin, address(rToken));
    }

    function _deployRToken(
        IMainP0 main,
        string memory name,
        string memory symbol
    ) internal override returns (IRToken) {
        return new RTokenExtension(_admin, main, name, symbol);
    }

    function _deployStRSR(
        IMainP0 main,
        string memory name,
        string memory symbol
    ) internal override returns (IStRSR) {
        return new StRSRExtension(_admin, main, name, symbol);
    }

    function _deployAssetManager(
        IMain main,
        IVault vault,
        address owner,
        ICollateral[] memory approvedCollateral
    ) internal override returns (IAssetManager) {
        return new AssetManagerExtension(_admin, main, vault, market, owner, approvedCollateral);
    }

    function INVARIANT_currentDeploymentRegistered() internal view {
        bool found = false;
        for (uint256 i = 0; i < deployments.length; i++) {
            if (_main == deployments[i]) {
                found = true;
            }
        }
        assert(found);
    }
}
