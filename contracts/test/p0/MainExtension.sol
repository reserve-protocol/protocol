// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/utils/Address.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/test/Mixins.sol";
import "contracts/mocks/ERC20Mock.sol";
import "contracts/p0/interfaces/IAsset.sol";
import "contracts/p0/interfaces/IMarket.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/libraries/Oracle.sol";
import "contracts/p0/MainP0.sol";
import "./RTokenExtension.sol";

import "hardhat/console.sol";

/// Enables generic testing harness to set _msgSender() for Main.
contract MainExtension is ContextMixin, MainP0, IExtension {
    using Address for address;
    using FixLib for Fix;

    constructor(address admin) ContextMixin(admin) {}

    function init(ConstructorArgs calldata args) public virtual override {
        super.init(args);
    }

    function issueInstantly(address account, uint256 amount) public {
        uint256 start = rTokenAsset.erc20().balanceOf(account);
        connect(account);
        issue(amount);
        issuances[issuances.length - 1].blockAvailableAt = block.number;
        _processSlowIssuance();
        require(rTokenAsset.erc20().balanceOf(account) - start == amount, "issue failure");
    }

    function assertInvariants() external view override {
        assert(_INVARIANT_stateDefined());
        assert(_INVARIANT_configurationValid());
        assert(_INVARIANT_fullyCapitalizedOrNotCalm());
        assert(_INVARIANT_nextRewardsInFutureOrNow());
        assert(_INVARIANT_quoteMonotonic());
        assert(_INVARIANT_tokensAndQuantitiesSameLength());
        assert(_INVARIANT_pricesDefined());
        assert(_INVARIANT_issuancesAreValid());
        // _INVARIANT_baseFactorDefined();
        // _INVARIANT_hasCollateralConfiguration();
        // _INVARIANT_toBUInverseFromBU();
        // _INVARIANT_fromBUInverseToBU();
        // _INVARIANT_vaultNotInPastVaults();
        // _INVARIANT_auctionsPartitionCleanly();
        // _INVARIANT_auctionsClosedInThePast();
    }

    function _msgSender() internal view override returns (address) {
        return _mixinMsgSender();
    }

    function _INVARIANT_stateDefined() internal view returns (bool ok) {
        ok = true;
        ok = ok && address(_oracle.compound) != address(0);
        ok = ok && address(_oracle.aave) != address(0);
        ok = ok && address(furnace) != address(0);
        ok = ok && address(stRSR) != address(0);
        ok = ok && address(rTokenAsset) != address(0);
        ok = ok && address(rsrAsset) != address(0);
        ok = ok && address(compAsset) != address(0);
        ok = ok && address(aaveAsset) != address(0);
        if (!ok) {
            console.log("_INVARIANT_stateDefined violated");
        }
    }

    function _INVARIANT_configurationValid() internal view returns (bool ok) {
        ok = true;
        ok = ok && rewardStart > 0;
        ok = ok && rewardPeriod > 0;
        ok = ok && auctionPeriod > 0;
        ok = ok && stRSRWithdrawalDelay > 0;
        ok = ok && defaultDelay > 0;
        ok = ok && maxTradeSlippage.gte(FIX_ZERO) && maxTradeSlippage.lte(FIX_ONE);
        ok = ok && maxAuctionSize.gte(FIX_ZERO) && maxAuctionSize.lte(FIX_ONE);
        ok =
            ok &&
            minRecapitalizationAuctionSize.gte(FIX_ZERO) &&
            minRecapitalizationAuctionSize.lte(FIX_ONE);
        ok = ok && minRevenueAuctionSize.gte(FIX_ZERO) && minRevenueAuctionSize.lte(FIX_ONE);
        ok = ok && migrationChunk.gte(FIX_ZERO) && migrationChunk.lte(FIX_ONE);
        ok = ok && issuanceRate.gte(FIX_ZERO) && issuanceRate.lte(FIX_ONE);
        ok = ok && defaultThreshold.gte(FIX_ZERO) && defaultThreshold.lte(FIX_ONE);
        ok = ok && f.gte(FIX_ZERO) && f.lte(FIX_ONE);
        if (!ok) {
            console.log("_INVARIANT_configurationValid violated");
        }
    }

    function _INVARIANT_fullyCapitalizedOrNotCalm() internal view returns (bool ok) {
        ok = true;
        ok = ok && (fullyCapitalized() || _mood != Mood.CALM);
        if (!ok) {
            console.log("_INVARIANT_fullyCapitalizedOrNotCalm violated");
        }
    }

    function _INVARIANT_nextRewardsInFutureOrNow() internal view returns (bool ok) {
        ok = true;
        ok = ok && nextRewards() >= block.timestamp;
        if (!ok) {
            console.log("_INVARIANT_nextRewardsInFutureOrNow violated");
        }
    }

    function _INVARIANT_quoteMonotonic() internal view returns (bool ok) {
        ok = true;
        bytes memory result = address(this).functionStaticCall(abi.encodeWithSignature("quote(uint256)", 1e18));
        uint256[] memory one = abi.decode(result, (uint256[]));
        bytes memory result2 = address(this).functionStaticCall(abi.encodeWithSignature("quote(uint256)", 1e18 + 1));
        uint256[] memory two = abi.decode(result2, (uint256[]));
        bytes memory result3 = address(this).functionStaticCall(abi.encodeWithSignature("quote(uint256)", 2e18));
        uint256[] memory three = abi.decode(result3, (uint256[]));
        ok = ok && one.length == two.length;
        ok = ok && two.length == three.length;
        for (uint256 i = 0; i < one.length; i++) {
            ok = ok && one[i] <= two[i];
            ok = ok && two[i] <= three[i];
        }
        if (!ok) {
            console.log("_INVARIANT_quoteMonotonic violated");
        }
    }

    function _INVARIANT_tokensAndQuantitiesSameLength() internal view returns (bool ok) {
        ok = true;
        bytes memory result = address(this).functionStaticCall(abi.encodeWithSignature("quote(uint256)", 1e18));
        uint256[] memory quantities = abi.decode(result, (uint256[]));
        ok = ok && backingTokens().length == quantities.length;
        if (!ok) {
            console.log("_INVARIANT_tokensAndQuantitiesSameLength violated");
        }
    }

    function _INVARIANT_pricesDefined() internal view returns (bool ok) {
        ok = true;
        for (uint256 i = 0; i < vault.size(); i++) {
            ICollateral c = vault.collateralAt(i);
            if (c.isFiatcoin()) {
                ok = ok && consultOracle(Oracle.Source.AAVE, address(c.erc20())).gt(FIX_ZERO);
            }
        }
        ok = ok && consultOracle(Oracle.Source.COMPOUND, address(compAsset.erc20())).gt(FIX_ZERO);
        ok = ok && consultOracle(Oracle.Source.AAVE, address(rsrAsset.erc20())).gt(FIX_ZERO);
        ok = ok && consultOracle(Oracle.Source.AAVE, address(aaveAsset.erc20())).gt(FIX_ZERO);
        if (!ok) {
            console.log("_INVARIANT_pricesDefined violated");
        }
    }

    function _INVARIANT_issuancesAreValid() internal view returns (bool ok) {
        ok = true;
        for (uint256 i = 0; i < issuances.length; i++) {
            if (issuances[i].processed && issuances[i].blockAvailableAt > block.number) {
                ok = false;
            }
        }
        if (!ok) {
            console.log("_INVARIANT_issuancesAreValid violated");
        }
    }

    // TODO: this
    //     function _INVARIANT_stateDefined() internal view {
    //     assert(_historicalBasketDilution.gt(FIX_ZERO));
    //     assert(_prevBasketRate.gt(FIX_ZERO));
    //     assert(_approvedCollateral.length() > 0);
    //     assert(_alltimeCollateral.length() > 0);
    //     assert(_fiatcoins.length() > 0);
    //     assert(address(main) != address(0));
    //     assert(address(vault) != address(0));
    // }

    // function _INVARIANT_baseFactorDefined() internal view {
    //     bytes memory result = address(this).functionStaticCall(abi.encodeWithSignature("baseFactor()"));
    //     Fix b = abi.decode(result, (Fix));
    //     assert(b.gt(FIX_ZERO));
    // }

    // function _INVARIANT_hasCollateralConfiguration() internal view {
    //     assert(approvedFiatcoins().length > 0);
    // }

    // function _INVARIANT_toBUInverseFromBU() internal view {
    //     uint256 supply = main.rToken().totalSupply();
    //     bytes memory result = address(this).functionStaticCall(abi.encodeWithSignature("toBUs(uint256)", supply));
    //     bytes memory result2 = address(this).functionStaticCall(
    //         abi.encodeWithSignature("fromBUs(uint256)", abi.decode(result, (uint256)))
    //     );
    //     assert(supply == abi.decode(result2, (uint256)));
    // }

    // function _INVARIANT_fromBUInverseToBU() internal view {
    //     uint256 bu_s = vault.basketUnits(address(this));
    //     bytes memory result = address(this).functionStaticCall(abi.encodeWithSignature("fromBUs(uint256)", bu_s));
    //     bytes memory result2 = address(this).functionStaticCall(
    //         abi.encodeWithSignature("toBUs(uint256)", abi.decode(result, (uint256)))
    //     );
    //     assert(bu_s == abi.decode(result2, (uint256)));
    // }

    // function _INVARIANT_vaultNotInPastVaults() internal view {
    //     for (uint256 i = 0; i < pastVaults.length; i++) {
    //         if (vault == pastVaults[i]) {
    //             assert(false);
    //         }
    //     }
    // }

    // function _INVARIANT_auctionsPartitionCleanly() internal view {
    //     bool foundOpen = false;
    //     for (uint256 i = 0; i < auctions.length; i++) {
    //         if (auctions[i].isOpen) {
    //             foundOpen = true;
    //         } else if (foundOpen) {
    //             assert(false);
    //         }
    //     }
    // }

    // function _INVARIANT_auctionsClosedInThePast() internal view {
    //     for (uint256 i = 0; i < auctions.length; i++) {
    //         if (!auctions[i].isOpen && auctions[i].endTime > block.timestamp) {
    //             assert(false);
    //         }
    //     }
    // }
}
