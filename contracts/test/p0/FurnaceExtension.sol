// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/test/Mixins.sol";
import "contracts/mocks/ERC20Mock.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/interfaces/IRToken.sol";
import "contracts/p0/Furnace.sol";
import "./RTokenExtension.sol";

/// Enables generic testing harness to set _msgSender() for AssetManager.
contract FurnaceExtension is ContextMixin, FurnaceP0, IExtension {
    using EnumerableSet for EnumerableSet.AddressSet;
    using FixLib for Fix;
    using Address for address;

    constructor(
        address admin,
        IRToken rToken,
        uint256 batchDuration
    ) ContextMixin(admin) FurnaceP0(rToken, batchDuration) {}

    function assertInvariants() external override {
        _INVARIANT_stateDefined();
        _INVARIANT_burnIdempotent();
    }

    function _msgSender() internal view override returns (address) {
        return _mixinMsgSender();
    }

    function _INVARIANT_stateDefined() internal view {
        assert(address(rToken) != address(0));
    }

    /// Burns any vested RToken and checks that the second call is a no-op
    function _INVARIANT_burnIdempotent() internal {
        doBurn();
        uint256 burnt = rToken.totalSupply();
        doBurn();
        assert(burnt == rToken.totalSupply());
    }
}
