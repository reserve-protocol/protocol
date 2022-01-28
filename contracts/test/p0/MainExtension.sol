// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "contracts/p0/interfaces/IOracle.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/p0/interfaces/IAsset.sol";
import "contracts/p0/interfaces/IMarket.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/interfaces/IOracle.sol";
import "contracts/test/Mixins.sol";
import "contracts/test/ProtoState.sol";
import "contracts/mocks/ERC20Mock.sol";
import "contracts/p0/Main.sol";
import "./RTokenExtension.sol";

import "hardhat/console.sol";

/// Enables generic testing harness to set _msgSender() for Main.
contract MainExtension is ContextMixin, MainP0, IExtension {
    using Address for address;
    using EnumerableSet for EnumerableSet.AddressSet;
    using FixLib for Fix;

    constructor(address admin) ContextMixin(admin) {}

    function init(ConstructorArgs calldata args) public virtual override {
        super.init(args);
    }

    function issueInstantly(address account, uint256 amount) public {
        uint256 start = rTokenAsset().erc20().balanceOf(account);
        connect(account);
        issue(amount);
        issuances[issuances.length - 1].blockAvailableAt = toFix(block.number);
        processSlowIssuance();
        require(rTokenAsset().erc20().balanceOf(account) - start == amount, "issue failure");
    }

    /// @return targets {ref/BU} The reference targets targeted per BU
    function basketRefTargets() external view returns (Fix[] memory targets) {
        targets = new Fix[](basket.size);
        for (uint256 i = 0; i < basket.size; i++) {
            targets[i] = basket.refAmts[basket.collateral[i]];
        }
    }

    function STATE_revenueDistribution() external view returns (RevenueDestination[] memory dist) {
        dist = new RevenueDestination[](destinations.length());
        for (uint256 i = 0; i < destinations.length(); i++) {
            RevenueShare storage rs = distribution[destinations.at(i)];
            dist[i] = RevenueDestination(destinations.at(i), rs.rTokenDist, rs.rsrDist);
        }
    }

    function _msgSender() internal view override returns (address) {
        return _mixinMsgSender();
    }

    // ==== Invariants ====

    function assertInvariants() external view override {
        assert(INVARIANT_stateDefined());
        assert(INVARIANT_configurationValid());
        assert(INVARIANTdistributionValid());
        assert(INVARIANT_fullyCapitalized());
        assert(INVARIANT_nextRewardsInFutureOrNow());
        assert(INVARIANT_quoteMonotonic());
        assert(INVARIANT_tokensAndQuantitiesSameLength());
        assert(INVARIANT_pricesDefined());
        assert(INVARIANT_issuancesAreValid());
        assert(INVARIANT_amtBUsPerRTokDefined());
        assert(INVARIANT_toBUInverseFromBU());
        assert(INVARIANT_fromBUInverseToBU());
    }

    function INVARIANT_stateDefined() internal view returns (bool ok) {
        ok = true;
        ok = ok && address(revenueFurnace()) != address(0);
        ok = ok && address(stRSR()) != address(0);
        ok = ok && address(rTokenAsset()) != address(0);
        ok = ok && address(rsrAsset()) != address(0);
        ok = ok && address(compAsset()) != address(0);
        ok = ok && address(aaveAsset()) != address(0);
        if (!ok) {
            console.log("INVARIANT_stateDefined violated");
        }
    }

    function INVARIANT_configurationValid() internal view returns (bool ok) {
        ok = true;
        ok = ok && rewardStart() > 0;
        ok = ok && rewardPeriod() > 0;
        ok = ok && auctionPeriod() > 0;
        ok = ok && stRSRWithdrawalDelay() > 0;
        ok = ok && defaultDelay() > 0;
        ok = ok && maxTradeSlippage().gte(FIX_ZERO) && maxTradeSlippage().lte(FIX_ONE);
        ok = ok && maxAuctionSize().gte(FIX_ZERO) && maxAuctionSize().lte(FIX_ONE);
        ok = ok && minAuctionSize().gte(FIX_ZERO) && minAuctionSize().lte(FIX_ONE);
        ok = ok && issuanceRate().gte(FIX_ZERO) && issuanceRate().lte(FIX_ONE);
        ok = ok && defaultThreshold().gte(FIX_ZERO) && defaultThreshold().lte(FIX_ONE);
        if (!ok) {
            console.log("INVARIANT_configurationValid violated");
        }
    }

    function INVARIANTdistributionValid() internal view returns (bool somethingIsPositive) {
        for (uint256 i = 0; i < destinations.length(); i++) {
            Fix rsrDist = distribution[destinations.at(i)].rsrDist;
            Fix rTokenDist = distribution[destinations.at(i)].rTokenDist;
            if (rsrDist.gt(FIX_ZERO) || rTokenDist.gt(FIX_ZERO)) {
                somethingIsPositive = true;
            }
            if (rsrDist.lt(FIX_ZERO) || rTokenDist.lt(FIX_ZERO)) {
                return false;
            }
        }
    }

    function INVARIANT_fullyCapitalized() internal view returns (bool ok) {
        ok = true;
        // TODO: Check that we really want to assert this
        ok = ok && fullyCapitalized();
        if (!ok) {
            console.log("INVARIANT_fullyCapitalized violated");
        }
    }

    function INVARIANT_nextRewardsInFutureOrNow() internal view returns (bool ok) {
        ok = true;
        ok = ok && nextRewards() >= block.timestamp;
        if (!ok) {
            console.log("INVARIANT_nextRewardsInFutureOrNow violated");
        }
    }

    function INVARIANT_quoteMonotonic() internal view returns (bool ok) {
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
            console.log("INVARIANT_quoteMonotonic violated");
        }
    }

    function INVARIANT_tokensAndQuantitiesSameLength() internal view returns (bool ok) {
        ok = true;
        uint256[] memory quantities = quote(1e18);
        ok = ok && backingTokens().length == quantities.length;
        if (!ok) {
            console.log("INVARIANT_tokensAndQuantitiesSameLength violated");
        }
    }

    function INVARIANT_pricesDefined() internal view returns (bool ok) {
        ok = true;
        for (uint256 i = 0; i < basket.size; i++) {
            ok = ok && basket.collateral[i].price().gt(FIX_ZERO);
        }
        ok = ok && compAsset().price().gt(FIX_ZERO);
        ok = ok && rsrAsset().price().gt(FIX_ZERO);
        ok = ok && aaveAsset().price().gt(FIX_ZERO);
        if (!ok) {
            console.log("INVARIANT_pricesDefined violated");
        }
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

    // Ex-asset manager

    function INVARIANT_amtBUsPerRTokDefined() internal view returns (bool ok) {
        Fix b = amtBUsPerRTok();
        ok = b.gt(FIX_ZERO);
        if (!ok) {
            console.log("INVARIANT_amtBUsPerRTokDefined violated");
        }
    }

    function INVARIANT_toBUInverseFromBU() internal view returns (bool ok) {
        ok = true;
        Fix converted = toFix(fromBUs(targetBUs));
        ok = ok && converted.near(toFix(rToken().totalSupply()), toFix(2)); // < 2 away
        if (!ok) {
            console.log(
                "INVARIANT_toBUInverseFromBU violated",
                converted.floor(),
                rToken().totalSupply()
            );
        }
    }

    function INVARIANT_fromBUInverseToBU() internal view returns (bool ok) {
        ok = true;
        Fix bu_s = actualBUHoldings();
        ok = ok && toBUs(fromBUs(bu_s)).near(bu_s, toFix(2)); // < 2 away
        if (!ok) {
            console.log(
                "INVARIANT_fromBUInverseToBU violated",
                toBUs(fromBUs(bu_s)).round(),
                bu_s.round()
            );
        }
    }

    // TODO: Farm the work out to TraderExtensions
    // function INVARIANT_auctionsValid() internal view returns (bool ok) {
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
