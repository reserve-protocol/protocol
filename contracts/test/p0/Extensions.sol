// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/utils/Context.sol";
import "contracts/test/Mixins.sol";
import "contracts/p0/DeployerP0.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/interfaces/IRToken.sol";
import "contracts/p0/interfaces/IStRSR.sol";
import "contracts/p0/MainP0.sol";
import "contracts/p0/RTokenP0.sol";
import "contracts/p0/StRSRP0.sol";

interface IMainExtension is IContextMixin, IMain {}

interface IStRSRExtension is IContextMixin, IStRSR {}

interface IRTokenExtension is IContextMixin, IRToken {
    function adminMint(address recipient, uint256 amount) external returns (bool);
}

/// Enables generic testing harness to set _msgSender() for Main.
contract MainExtension is ContextMixin, MainP0, IMainExtension {
    constructor(
        address admin,
        Oracle.Info memory oracle_,
        Config memory config_
    ) ContextMixin(admin) MainP0(oracle_, config_) {}

    function _msgSender() internal view override returns (address) {
        return _mixinMsgSender();
    }
}

/// Enables generic testing harness to set _msgSender() for StRSR.
contract StRSRExtension is ContextMixin, StRSRP0, IStRSRExtension {
    constructor(
        address admin,
        IMain main_,
        string memory name_,
        string memory symbol_
    ) ContextMixin(admin) StRSRP0(main_, name_, symbol_) {}

    function _msgSender() internal view override returns (address) {
        return _mixinMsgSender();
    }
}

/// Enables generic testing harness to set _msgSender() for RToken.
contract RTokenExtension is ContextMixin, RTokenP0, IRTokenExtension {
    constructor(
        address admin,
        IMain main_,
        string memory name_,
        string memory symbol_
    ) ContextMixin(admin) RTokenP0(main_, name_, symbol_) {}

    function adminMint(address recipient, uint256 amount) external override returns (bool) {
        _mint(recipient, amount);
        return true;
    }

    function _msgSender() internal view override returns (address) {
        return _mixinMsgSender();
    }
}

//

/// Inject wrapper contracts into Deployer
contract DeployerExtension is DeployerP0 {
    address internal _deployer;

    constructor() {
        _deployer = msg.sender;
    }

    /// @dev Used for testing override to manipulate msg.sender
    function _deployMain(Oracle.Info memory oracle, Config memory config) internal override returns (IMain) {
        return new MainExtension(_deployer, oracle, config);
    }

    /// @dev Used for testing override to manipulate msg.sender
    function _deployRToken(
        IMain main,
        string memory name,
        string memory symbol
    ) internal override returns (IRToken) {
        return new RTokenExtension(_deployer, main, name, symbol);
    }

    /// @dev Used for testing override to manipulate msg.sender
    function _deployStRSR(
        IMain main,
        string memory name,
        string memory symbol
    ) internal override returns (IStRSR) {
        return new StRSRExtension(_deployer, main, name, symbol);
    }
}
