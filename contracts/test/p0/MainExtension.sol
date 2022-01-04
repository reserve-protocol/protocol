// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/p0/libraries/Oracle.sol";
import "contracts/test/Mixins.sol";
import "contracts/test/ProtoState.sol";
import "contracts/mocks/ERC20Mock.sol";
import "contracts/p0/interfaces/IAsset.sol";
import "contracts/p0/interfaces/IMarket.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/libraries/Oracle.sol";
import "contracts/p0/Main.sol";
import "./RTokenExtension.sol";

import "hardhat/console.sol";

/// Enables generic testing harness to set _msgSender() for Main.
contract MainExtension is ContextMixin, MainP0, IExtension {
    using Address for address;
    using EnumerableSet for EnumerableSet.AddressSet;
    using FixLib for Fix;
    using Oracle for Oracle.Info;

    constructor(address admin) ContextMixin(admin) {}

    function init(ConstructorArgs calldata args) public virtual override {
        super.init(args);
    }

    function issueInstantly(address account, uint256 amount) public {
        uint256 start = rTokenAsset().erc20().balanceOf(account);
        connect(account);
        issue(amount);
        issuances[issuances.length - 1].blockAvailableAt = toFix(block.number);
        _processSlowIssuance();
        require(rTokenAsset().erc20().balanceOf(account) - start == amount, "issue failure");
    }

    function STATE_revenueDistribution()
        external
        view
        returns (RevenueDestination[] memory distribution)
    {
        distribution = new RevenueDestination[](_destinations.length());
        for (uint256 i = 0; i < _destinations.length(); i++) {
            RevenueShare storage rs = _distribution[_destinations.at(i)];
            distribution[i] = RevenueDestination(_destinations.at(i), rs.rTokenDist, rs.rsrDist);
        }
    }

    function _msgSender() internal view override returns (address) {
        return _mixinMsgSender();
    }

    // ==== Invariants ====

    function assertInvariants() external view override {
        assert(_INVARIANT_stateDefined());
        assert(_INVARIANT_configurationValid());
        assert(_INVARIANT_distributionValid());
        assert(_INVARIANT_fullyCapitalizedOrNotCalm());
        assert(_INVARIANT_nextRewardsInFutureOrNow());
        assert(_INVARIANT_quoteMonotonic());
        assert(_INVARIANT_tokensAndQuantitiesSameLength());
        assert(_INVARIANT_pricesDefined());
        assert(_INVARIANT_issuancesAreValid());
        assert(_INVARIANT_baseFactorDefined());
        assert(_INVARIANT_hasCollateralConfiguration());
        assert(_INVARIANT_toBUInverseFromBU());
        assert(_INVARIANT_fromBUInverseToBU());
    }

    function _INVARIANT_stateDefined() internal view returns (bool ok) {
        ok = true;
        ok = ok && address(oracle().compound) != address(0);
        ok = ok && address(oracle().aave) != address(0);
        ok = ok && address(revenueFurnace()) != address(0);
        ok = ok && address(stRSR()) != address(0);
        ok = ok && address(rTokenAsset()) != address(0);
        ok = ok && address(rsrAsset()) != address(0);
        ok = ok && address(compAsset()) != address(0);
        ok = ok && address(aaveAsset()) != address(0);
        ok = ok && _historicalBasketDilution.gt(FIX_ZERO);
        ok = ok && _approvedCollateral.length() > 0;
        ok = ok && _allAssets.length() > 0;
        ok = ok && address(vault()) != address(0);
        ok = ok && vaults.length > 0;
        if (!ok) {
            console.log("_INVARIANT_stateDefined violated");
        }
    }

    function _INVARIANT_configurationValid() internal view returns (bool ok) {
        ok = true;
        ok = ok && rewardStart() > 0;
        ok = ok && rewardPeriod() > 0;
        ok = ok && auctionPeriod() > 0;
        ok = ok && stRSRWithdrawalDelay() > 0;
        ok = ok && defaultDelay() > 0;
        ok = ok && maxTradeSlippage().gte(FIX_ZERO) && maxTradeSlippage().lte(FIX_ONE);
        ok = ok && maxAuctionSize().gte(FIX_ZERO) && maxAuctionSize().lte(FIX_ONE);
        ok =
            ok &&
            minRecapitalizationAuctionSize().gte(FIX_ZERO) &&
            minRecapitalizationAuctionSize().lte(FIX_ONE);
        ok = ok && minRevenueAuctionSize().gte(FIX_ZERO) && minRevenueAuctionSize().lte(FIX_ONE);
        ok = ok && migrationChunk().gte(FIX_ZERO) && migrationChunk().lte(FIX_ONE);
        ok = ok && issuanceRate().gte(FIX_ZERO) && issuanceRate().lte(FIX_ONE);
        ok = ok && defaultThreshold().gte(FIX_ZERO) && defaultThreshold().lte(FIX_ONE);
        if (!ok) {
            console.log("_INVARIANT_configurationValid violated");
        }
    }

    function _INVARIANT_distributionValid() internal view returns (bool somethingIsPositive) {
        for (uint256 i = 0; i < _destinations.length(); i++) {
            Fix rsrDist = _distribution[_destinations.at(i)].rsrDist;
            Fix rTokenDist = _distribution[_destinations.at(i)].rTokenDist;
            if (rsrDist.gt(FIX_ZERO) || rTokenDist.gt(FIX_ZERO)) {
                somethingIsPositive = true;
            }
            if (rsrDist.lt(FIX_ZERO) || rTokenDist.lt(FIX_ZERO)) {
                return false;
            }
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
        uint256[] memory one = quote(1e18);
        uint256[] memory two = quote(1e18 + 1);
        uint256[] memory three = quote(2e18);
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
        uint256[] memory quantities = quote(1e18);
        ok = ok && backingTokens().length == quantities.length;
        if (!ok) {
            console.log("_INVARIANT_tokensAndQuantitiesSameLength violated");
        }
    }

    function _INVARIANT_pricesDefined() internal view returns (bool ok) {
        ok = true;
        Oracle.Info memory oracle_ = oracle();
        for (uint256 i = 0; i < vault().size(); i++) {
            ICollateral c = vault().collateralAt(i);
            if (c.isFiatcoin()) {
                ok = ok && oracle_.consult(Oracle.Source.AAVE, address(c.erc20())).gt(FIX_ZERO);
            }
        }
        ok =
            ok &&
            oracle_.consult(Oracle.Source.COMPOUND, address(compAsset().erc20())).gt(FIX_ZERO);
        ok = ok && oracle_.consult(Oracle.Source.AAVE, address(rsrAsset().erc20())).gt(FIX_ZERO);
        ok = ok && oracle_.consult(Oracle.Source.AAVE, address(aaveAsset().erc20())).gt(FIX_ZERO);
        if (!ok) {
            console.log("_INVARIANT_pricesDefined violated");
        }
    }

    function _INVARIANT_issuancesAreValid() internal view returns (bool ok) {
        ok = true;
        for (uint256 i = 0; i < issuances.length; i++) {
            if (issuances[i].processed && issuances[i].blockAvailableAt.lt(toFix(block.number))) {
                ok = false;
            }
        }
        if (!ok) {
            console.log("_INVARIANT_issuancesAreValid violated");
        }
    }

    // Ex-asset manager

    function _INVARIANT_baseFactorDefined() internal view returns (bool ok) {
        Fix b = _baseFactor();
        ok = b.gt(FIX_ZERO);
        if (!ok) {
            console.log("_INVARIANT_baseFactorDefined violated");
        }
    }

    function _INVARIANT_hasCollateralConfiguration() internal view returns (bool ok) {
        return approvedFiatcoins().length > 0;
    }

    function _INVARIANT_toBUInverseFromBU() internal view returns (bool ok) {
        ok = true;
        Fix converted = toFix(fromBUs(toBUs(rToken().totalSupply())));
        ok = ok && converted.near(toFix(rToken().totalSupply()), toFix(2)); // < 2 away
        if (!ok) {
            console.log(
                "_INVARIANT_toBUInverseFromBU violated",
                converted.floor(),
                rToken().totalSupply()
            );
        }
    }

    function _INVARIANT_fromBUInverseToBU() internal view returns (bool ok) {
        ok = true;
        uint256 bu_s = vault().basketUnits(address(this));
        ok = ok && toFix(toBUs(fromBUs(bu_s))).near(toFix(bu_s), toFix(2)); // < 2 away
        if (!ok) {
            console.log("_INVARIANT_fromBUInverseToBU violated", toBUs(fromBUs(bu_s)), bu_s);
        }
    }

    // TODO: Farm the work out to TraderExtensions
    // function _INVARIANT_auctionsValid() internal view returns (bool ok) {
    //     bool foundOpen = false;
    //     for (uint256 i = 0; i < auctions.length; i++) {
    //         if (auctions[i].status == AuctionStatus.OPEN) {
    //             foundOpen = true;
    //         } else if (
    //             foundOpen ||
    //             (auctions[i].status == AuctionStatus.DONE && auctions[i].endTime < block.timestamp)
    //         ) {
    //             return false;
    //         }
    //     }
    //     return true;
    // }
}
