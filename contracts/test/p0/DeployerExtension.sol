// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "contracts/p0/Deployer.sol";
import "contracts/p0/interfaces/IAsset.sol";
import "contracts/p0/interfaces/IMarket.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/interfaces/IRToken.sol";
import "contracts/p0/interfaces/IStRSR.sol";
import "contracts/test/Mixins.sol";
import "./FurnaceExtension.sol";
import "./MainExtension.sol";
import "./RTokenExtension.sol";
import "./StRSRExtension.sol";

/// Inject wrapper contracts into Deployer
contract DeployerExtension is DeployerP0, IExtension {
    address internal _admin;
    IMain internal _main;

    constructor(
        IERC20Metadata rsr_,
        IERC20Metadata comp_,
        IERC20Metadata aave_,
        IMarket market_,
        IOracle compoundOracle_,
        IOracle aaveOracle_
    ) DeployerP0(rsr_, comp_, aave_, market_, compoundOracle_, aaveOracle_) {
        _admin = msg.sender;
    }

    function assertInvariants() external view override {
        INVARIANT_currentDeploymentRegistered();
    }

    function deployMain() internal view override returns (IMain) {
        return MainExtension(_admin);
    }

    function deployRevenueFurnace(IRToken rToken, uint256 batchDuration)
        internal
        override
        returns (IFurnace)
    {
        return new FurnaceExtension(_admin, rToken, batchDuration);
    }

    function deployRToken(string memory name, string memory symbol)
        internal
        override
        returns (IRToken)
    {
        return new RTokenExtension(_admin, name, symbol);
    }

    function deployStRSR(
        IMain main,
        string memory name,
        string memory symbol
    ) internal override returns (IStRSR) {
        return new StRSRExtension(_admin, main, name, symbol);
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
