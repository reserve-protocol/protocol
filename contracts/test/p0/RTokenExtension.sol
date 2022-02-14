// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "contracts/test/Mixins.sol";
import "contracts/p0/interfaces/IRToken.sol";
import "contracts/p0/RToken.sol";
import "contracts/libraries/Fixed.sol";

import "hardhat/console.sol";

/// Enables generic testing harness to set _msgSender() for RToken.
contract RTokenExtension is ContextMixin, RTokenP0, IExtension {
    using EnumerableSet for EnumerableSet.AddressSet;
    using FixLib for Fix;

    constructor(
        address admin,
        IMain main,
        string memory name_,
        string memory symbol_,
        address owner_
    ) ContextMixin(admin) RTokenP0(main, name_, symbol_, owner_) {}

    function forceSlowIssuanceToComplete(address account) external {
        for (uint256 i = 0; i < issuances[account].length; i++) {
            if (!issuances[account][i].processed) {
                issuances[account][i].blockAvailableAt = toFix(block.number);
                assert(tryVestIssuance(account, i) == issuances[account][i].amount);
            }
        }
    }

    function _msgSender() internal view override returns (address) {
        return _mixinMsgSender();
    }

    // ==== Invariants ====

    function assertInvariants() external view override {
        assert(INVARIANT_issuancesAreValid());
    }

    function INVARIANT_issuancesAreValid() internal view returns (bool ok) {
        ok = true;
        for (uint256 i = 0; i < accounts.length(); i++) {
            SlowIssuance[] storage queue = issuances[accounts.at(i)];
            for (uint256 j = 0; j < queue.length; j++) {
                if (queue[j].processed && queue[j].blockAvailableAt.lt(toFix(block.number))) {
                    ok = false;
                }
            }
        }
        if (!ok) {
            console.log("INVARIANT_issuancesAreValid violated");
        }
    }
}
