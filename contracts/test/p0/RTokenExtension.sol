// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/test/Mixins.sol";
import "contracts/p0/interfaces/IRToken.sol";
import "contracts/p0/RTokenP0.sol";

/// Enables generic testing harness to set _msgSender() for RToken.
contract RTokenExtension is ContextMixin, RTokenP0, IExtension {
    constructor(
        address admin,
        string memory name_,
        string memory symbol_
    ) ContextMixin(admin) RTokenP0(name_, symbol_) {}

    function assertInvariants() external view override {
        assert(true);
    }

    function adminMint(address recipient, uint256 amount) external returns (bool) {
        _mint(recipient, amount);
        return true;
    }

    function _msgSender() internal view override returns (address) {
        return _mixinMsgSender();
    }
}
