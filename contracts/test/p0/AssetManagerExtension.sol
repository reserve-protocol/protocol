// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/test/Mixins.sol";
import "contracts/mocks/ERC20Mock.sol";
import "contracts/p0/interfaces/IMarket.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/AssetManagerP0.sol";
import "./RTokenExtension.sol";

/// Enables generic testing harness to set _msgSender() for AssetManager.
contract AssetManagerExtension is IExtension, ContextMixin, AssetManagerP0 {
    using EnumerableSet for EnumerableSet.AddressSet;
    using FixLib for Fix;
    using Address for address;

    constructor(
        address admin,
        IMain main,
        IVault vault,
        IMarket market,
        address owner,
        ICollateral[] memory approvedCollateral
    ) ContextMixin(admin) AssetManagerP0(main, vault, market, owner, approvedCollateral) {}

    function assertInvariants() external override {
        _INVARIANT_baseFactorDefined();
        _INVARIANT_hasCollateralConfiguration();
        _INVARIANT_toBUInverseFromBU();
        _INVARIANT_fromBUInverseToBU();
        _INVARIANT_vaultNotInPastVaults();
        _INVARIANT_auctionsPartitionCleanly();
        _INVARIANT_auctionsClosedInThePast();
    }

    function _msgSender() internal view override returns (address) {
        return _mixinMsgSender();
    }

    function _INVARIANT_stateDefined() internal view {
        assert(_historicalBasketDilution.gt(FIX_ZERO));
        assert(_prevBasketRate.gt(FIX_ZERO));
        assert(_approvedCollateral.length() > 0);
        assert(_alltimeCollateral.length() > 0);
        assert(_fiatcoins.length() > 0);
        assert(address(main) != address(0));
        assert(address(vault) != address(0));
    }

    function _INVARIANT_baseFactorDefined() internal view {
        bytes memory result = address(this).functionStaticCall(abi.encodeWithSignature("baseFactor()"));
        Fix b = abi.decode(result, (Fix));
        assert(b.gt(FIX_ZERO));
    }

    function _INVARIANT_hasCollateralConfiguration() internal view {
        assert(approvedFiatcoins().length > 0);
    }

    function _INVARIANT_toBUInverseFromBU() internal view {
        uint256 supply = main.rToken().totalSupply();
        bytes memory result = address(this).functionStaticCall(abi.encodeWithSignature("toBUs(uint256)", supply));
        bytes memory result2 = address(this).functionStaticCall(
            abi.encodeWithSignature("fromBUs(uint256)", abi.decode(result, (uint256)))
        );
        assert(supply == abi.decode(result2, (uint256)));
    }

    function _INVARIANT_fromBUInverseToBU() internal view {
        uint256 bu_s = vault.basketUnits(address(this));
        bytes memory result = address(this).functionStaticCall(abi.encodeWithSignature("fromBUs(uint256)", bu_s));
        bytes memory result2 = address(this).functionStaticCall(
            abi.encodeWithSignature("toBUs(uint256)", abi.decode(result, (uint256)))
        );
        assert(bu_s == abi.decode(result2, (uint256)));
    }

    function _INVARIANT_vaultNotInPastVaults() internal view {
        for (uint256 i = 0; i < pastVaults.length; i++) {
            if (vault == pastVaults[i]) {
                assert(false);
            }
        }
    }

    function _INVARIANT_auctionsPartitionCleanly() internal view {
        bool foundOpen = false;
        for (uint256 i = 0; i < auctions.length; i++) {
            if (auctions[i].isOpen) {
                foundOpen = true;
            } else if (foundOpen) {
                assert(false);
            }
        }
    }

    function _INVARIANT_auctionsClosedInThePast() internal view {
        for (uint256 i = 0; i < auctions.length; i++) {
            if (!auctions[i].isOpen && auctions[i].endTime > block.timestamp) {
                assert(false);
            }
        }
    }
}
