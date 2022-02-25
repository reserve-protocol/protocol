// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/p0/interfaces/IAsset.sol";
import "contracts/p0/interfaces/IMarket.sol";
import "contracts/p0/interfaces/IMain.sol";
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
        uint256 start = IRToken(addr(RTOKEN)).balanceOf(account);
        connect(account);
        issue(amount);
        RTokenExtension(address(IRToken(addr(RTOKEN)))).forceSlowIssuanceToComplete(account);
        require(IRToken(addr(RTOKEN)).balanceOf(account) - start == amount, "issue failure");
    }

    /// @return targets {ref/BU} The reference targets targeted per BU
    function basketRefTargets() external view returns (Fix[] memory targets) {
        // TODO
        // targets = new Fix[](basket.collateral.length);
        // for (uint256 i = 0; i < basket.collateral.length; i++) {
        //     targets[i] = basket.refAmts[basket.collateral[i]];
        // }
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
        assert(INVARIANT_distributionValid());
        assert(INVARIANT_fullyCapitalized());
        assert(INVARIANT_nextRewardsInFutureOrNow());
        assert(INVARIANT_pricesDefined());
    }

    function INVARIANT_stateDefined() internal view returns (bool ok) {
        ok = true;
        ok = ok && addr(REVENUE_FURNACE) != address(0);
        ok = ok && addr(ST_RSR) != address(0);
        ok = ok && addr(RTOKEN) != address(0);
        ok = ok && addr(RSR) != address(0);
        if (!ok) {
            console.log("INVARIANT_stateDefined violated");
        }
    }

    function INVARIANT_configurationValid() internal view returns (bool ok) {
        ok =
            Uint(REWARD_START) > 0 &&
            Uint(REWARD_PERIOD) > 0 &&
            Uint(AUCTION_PERIOD) > 0 &&
            Uint(ST_RSR_PAY_PERIOD) > 0 &&
            Uint(ST_RSR_WITHDRAWAL_DELAY) > 0 &&
            Uint(DEFAULT_DELAY) > 0 &&
            fix(MAX_TRADE_SLIPPAGE).gte(FIX_ZERO) &&
            fix(MAX_TRADE_SLIPPAGE).lte(FIX_ONE) &&
            fix(ISSUANCE_RATE).gte(FIX_ZERO) &&
            fix(ISSUANCE_RATE).lte(FIX_ONE) &&
            fix(DEFAULT_THRESHOLD).gte(FIX_ZERO) &&
            fix(DEFAULT_THRESHOLD).lte(FIX_ONE) &&
            fix(ST_RSR_PAY_RATIO).gte(FIX_ZERO) &&
            fix(ST_RSR_PAY_RATIO).lte(FIX_ONE);
        if (!ok) console.log("INVARIANT_configurationValid violated");
    }

    function INVARIANT_distributionValid() internal view returns (bool somethingIsPositive) {
        for (uint256 i = 0; i < destinations.length(); i++) {
            uint16 rsrDist = distribution[destinations.at(i)].rsrDist;
            uint16 rTokenDist = distribution[destinations.at(i)].rTokenDist;
            if (rsrDist > 0 || rTokenDist > 0) return true;
        }
        return false;
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

    function INVARIANT_pricesDefined() internal view returns (bool ok) {
        ok = true;
        IERC20Metadata[] memory erc20s = registeredERC20s();
        for (uint256 i = 0; i < erc20s.length; i++) {
            ok = ok && toAsset(erc20s[i]).price().gt(FIX_ZERO);
        }
        ok = ok && toAsset(IERC20Metadata(addr(RSR))).price().gt(FIX_ZERO);
        ok = ok && toAsset(IRToken(addr(RTOKEN))).price().gt(FIX_ZERO);
        if (!ok) {
            console.log("INVARIANT_pricesDefined violated");
        }
    }
}
