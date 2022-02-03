// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/test/Mixins.sol";
import "contracts/p0/interfaces/IRToken.sol";
import "contracts/p0/RToken.sol";
import "contracts/libraries/Fixed.sol";

import "hardhat/console.sol";

/// Enables generic testing harness to set _msgSender() for RToken.
contract RTokenExtension is ContextMixin, RTokenP0, IExtension {
    using FixLib for Fix;

    constructor(
        address admin,
        IMain main,
        string memory name_,
        string memory symbol_,
        address owner_
    ) ContextMixin(admin) RTokenP0(main, name_, symbol_, owner_) {}

    function forceSlowIssuanceToComplete() external returns (bool) {
        for (uint256 i = 0; i < issuances.length; i++) {
            if (!issuances[i].processed) {
                issuances[i].blockAvailableAt = toFix(block.number);
            }
        }
        poke();
        return true;
    }

    function _msgSender() internal view override returns (address) {
        return _mixinMsgSender();
    }

    // ==== Invariants ====

    function assertInvariants() external view override {
        assert(INVARIANT_issuancesAreValid());
        assert(INVARIANT_basketRateDefined());
    }

    function INVARIANT_issuancesAreValid() internal view returns (bool ok) {
        ok = true;
        for (uint256 i = 0; i < issuances.length; i++) {
            if (issuances[i].processed && issuances[i].blockAvailableAt.lt(toFix(block.number))) {
                ok = false;
            }
        }
        if (!ok) {
            console.log("INVARIANT_issuancesAreValid violated");
        }
    }

    function INVARIANT_basketRateDefined() internal view returns (bool ok) {
        ok = basketRate().gt(FIX_ZERO);
        if (!ok) {
            console.log("INVARIANT_basketRateDefined violated");
        }
    }
}
