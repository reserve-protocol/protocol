// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/p0/DeployerP0.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/interfaces/IRToken.sol";
import "contracts/p0/interfaces/IStRSR.sol";
import "./MainExtension.sol";
import "./RTokenExtension.sol";
import "./StRSRExtension.sol";
import "./IExtension.sol";

/// Inject wrapper contracts into Deployer
contract DeployerExtension is IExtension, DeployerP0 {
    address internal _deployer;
    IMainP0 internal _main;

    constructor() {
        _deployer = msg.sender;
    }

    function checkInvariants() external override returns (bool) {
        return INVARIANT_currentDeploymentRegistered();
    }

    /// @dev Used for testing override to manipulate msg.sender
    function _deployMain(Oracle.Info memory oracle, Config memory config) internal override returns (IMainP0) {
        _main = IMainP0(address(new MainExtension(_deployer, oracle, config)));
        return _main;
    }

    /// @dev Used for testing override to manipulate msg.sender
    function _deployRToken(
        IMainP0 main,
        string memory name,
        string memory symbol
    ) internal override returns (IRToken) {
        return new RTokenExtension(_deployer, main, name, symbol);
    }

    /// @dev Used for testing override to manipulate msg.sender
    function _deployStRSR(
        IMainP0 main,
        string memory name,
        string memory symbol
    ) internal override returns (IStRSR) {
        return new StRSRExtension(_deployer, main, name, symbol);
    }

    function INVARIANT_currentDeploymentRegistered() internal view returns (bool) {
        for (uint256 i = 0; i < deployments.length; i++) {
            if (_main == deployments[i]) {
                return true;
            }
        }
        return false;
    }
}
