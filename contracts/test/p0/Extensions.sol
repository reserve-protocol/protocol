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

interface IRTokenExtension is IContextMixin, IRToken {}

/// Enables generic testing harness to set _msgSender() for Main.
contract MainExtension is IMainExtension, ContextMixin, MainP0 {
    constructor(
        Oracle.Info memory oracle_,
        Config memory config_,
        IERC20 rsr_
    ) MainP0(oracle_, config_, rsr_) {}

    function _msgSender() internal view override(Context, ContextMixin) returns (address) {
        return super._msgSender();
    }
}

/// Enables generic testing harness to set _msgSender() for StRSR.
contract StRSRExtension is IStRSRExtension, ContextMixin, StRSRP0 {
    constructor(
        IMain main_,
        string memory name_,
        string memory symbol_
    ) StRSRP0(main_, name_, symbol_) {}

    function _msgSender() internal view override(Context, ContextMixin) returns (address) {
        return super._msgSender();
    }
}

/// Enables generic testing harness to set _msgSender() for RToken.
contract RTokenExtension is IRTokenExtension, ContextMixin, RTokenP0 {
    constructor(
        IMain main_,
        string memory name_,
        string memory symbol_
    ) RTokenP0(main_, name_, symbol_) {}

    function adminMint(address recipient, uint256 amount) external returns (bool) {
        _mint(recipient, amount);
        return true;
    }

    function _msgSender() internal view override(Context, ContextMixin) returns (address) {
        return super._msgSender();
    }
}

//

/// Inject wrapper contracts into Deployer
contract DeployerExtension is DeployerP0 {
    /// @dev Used for testing override to manipulate msg.sender
    function _deployMain(
        Oracle.Info memory oracle,
        Config memory config,
        IERC20 rsr
    ) internal override returns (IMain) {
        return new MainExtension(oracle, config, rsr);
    }

    /// @dev Used for testing override to manipulate msg.sender
    function _deployRToken(
        IMain main,
        string memory name,
        string memory symbol
    ) internal override returns (IRToken) {
        return new RTokenExtension(main, name, symbol);
    }

    /// @dev Used for testing override to manipulate msg.sender
    function _deployStRSR(
        IMain main,
        string memory name,
        string memory symbol
    ) internal override returns (IStRSR) {
        return new StRSRExtension(main, name, symbol);
    }
}
