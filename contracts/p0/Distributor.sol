// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "../interfaces/IMain.sol";
import "./mixins/Component.sol";

contract DistributorP0 is ComponentP0, IDistributor {
    using SafeERC20 for IERC20;
    using FixLib for uint192;
    using EnumerableSet for EnumerableSet.AddressSet;

    EnumerableSet.AddressSet internal destinations;
    mapping(address => RevenueShare) public distribution;
    // invariant: distribution values are all nonnegative, and at least one is nonzero.
    // invariant: distribution[FURNACE].rsrDist == FIX_ZERO
    // invariant: distribution[ST_RSR].rTokenDist == FIX_ZERO

    address public constant FURNACE = address(1);
    address public constant ST_RSR = address(2);

    uint8 public constant MAX_DESTINATIONS_ALLOWED = MAX_DESTINATIONS; // 100

    function init(IMain main_, RevenueShare memory dist) public initializer {
        __Component_init(main_);

        _ensureSufficientTotal(dist.rTokenDist, dist.rsrDist);
        _setDistribution(FURNACE, RevenueShare(dist.rTokenDist, 0));
        _setDistribution(ST_RSR, RevenueShare(0, dist.rsrDist));
    }

    /// Set the RevenueShare for destination `dest`. Destinations `FURNACE` and `ST_RSR` refer to
    /// main.furnace() and main.stRSR().
    function setDistribution(address dest, RevenueShare memory share) external governance {
        // solhint-disable-next-line no-empty-blocks
        try main.rsrTrader().distributeTokenToBuy() {} catch {}
        // solhint-disable-next-line no-empty-blocks
        try main.rTokenTrader().distributeTokenToBuy() {} catch {}

        _setDistribution(dest, share);
        RevenueTotals memory revTotals = totals();
        _ensureSufficientTotal(revTotals.rTokenTotal, revTotals.rsrTotal);
    }

    /// Set RevenueShares for destinations. Destinations `FURNACE` and `ST_RSR` refer to
    /// main.furnace() and main.stRSR().
    /// @custom:governance
    function setDistributions(address[] calldata dests, RevenueShare[] calldata shares)
        external
        governance
    {
        require(dests.length == shares.length, "array length mismatch");

        // solhint-disable-next-line no-empty-blocks
        try main.rsrTrader().distributeTokenToBuy() {} catch {}
        // solhint-disable-next-line no-empty-blocks
        try main.rTokenTrader().distributeTokenToBuy() {} catch {}

        for (uint256 i = 0; i < dests.length; ++i) {
            _setDistribution(dests[i], shares[i]);
        }

        RevenueTotals memory revTotals = totals();
        _ensureSufficientTotal(revTotals.rTokenTotal, revTotals.rsrTotal);
    }

    /// Distribute revenue, in rsr or rtoken, per the distribution table.
    /// Requires that this contract has an allowance of at least
    /// `amount` tokens, from `from`, of the token at `erc20`.
    /// Only callable by RevenueTraders
    function distribute(IERC20 erc20, uint256 amount) external {
        // Intentionally do not check notTradingPausedOrFrozen, since handled by caller

        IERC20 rsr = main.rsr();

        require(
            _msgSender() == address(main.rsrTrader()) ||
                _msgSender() == address(main.rTokenTrader()),
            "RevenueTraders only"
        );
        require(erc20 == rsr || erc20 == IERC20(address(main.rToken())), "RSR or RToken");
        bool isRSR = erc20 == rsr; // if false: isRToken
        uint256 tokensPerShare;
        {
            RevenueTotals memory revTotals = totals();
            uint256 totalShares = isRSR ? revTotals.rsrTotal : revTotals.rTokenTotal;
            if (totalShares > 0) tokensPerShare = amount / totalShares;
            require(tokensPerShare > 0, "nothing to distribute");
        }

        // Evenly distribute revenue tokens per distribution share.
        // This rounds "early", and that's deliberate!

        bool accountRewards = false;

        for (uint256 i = 0; i < destinations.length(); i++) {
            address addrTo = destinations.at(i);

            uint256 numberOfShares = isRSR
                ? distribution[addrTo].rsrDist
                : distribution[addrTo].rTokenDist;
            if (numberOfShares == 0) continue;
            uint256 transferAmt = tokensPerShare * numberOfShares;

            if (addrTo == FURNACE) {
                addrTo = address(main.furnace());
                if (transferAmt > 0) accountRewards = true;
            } else if (addrTo == ST_RSR) {
                addrTo = address(main.stRSR());
                if (transferAmt > 0) accountRewards = true;
            }
            erc20.safeTransferFrom(_msgSender(), addrTo, transferAmt);
        }
        emit RevenueDistributed(erc20, _msgSender(), amount);

        // Perform reward accounting
        if (accountRewards) {
            if (isRSR) {
                main.stRSR().payoutRewards();
            } else {
                main.furnace().melt();
            }
        }
    }

    /// Returns the rsr + rToken shareTotals
    function totals() public view returns (RevenueTotals memory revTotals) {
        for (uint256 i = 0; i < destinations.length(); i++) {
            RevenueShare storage share = distribution[destinations.at(i)];
            revTotals.rTokenTotal += share.rTokenDist;
            revTotals.rsrTotal += share.rsrDist;
        }
    }

    /// Sets the distribution values - Internals
    function _setDistribution(address dest, RevenueShare memory share) internal {
        require(dest != address(0), "dest cannot be zero");
        require(
            dest != address(main.furnace()) && dest != address(main.stRSR()),
            "destination can not be furnace or strsr directly"
        );
        require(dest != address(main.daoFeeRegistry()), "destination cannot be daoFeeRegistry");
        if (dest == FURNACE) require(share.rsrDist == 0, "Furnace must get 0% of RSR");
        if (dest == ST_RSR) require(share.rTokenDist == 0, "StRSR must get 0% of RToken");
        require(share.rsrDist <= MAX_DISTRIBUTION, "RSR distribution too high");
        require(share.rTokenDist <= MAX_DISTRIBUTION, "RToken distribution too high");

        if (share.rsrDist == 0 && share.rTokenDist == 0) {
            destinations.remove(dest);
        } else {
            destinations.add(dest);
            require(destinations.length() <= MAX_DESTINATIONS_ALLOWED, "Too many destinations");
        }

        distribution[dest] = share;
        emit DistributionSet(dest, share.rTokenDist, share.rsrDist);
    }

    /// Ensures distribution values are large enough
    function _ensureSufficientTotal(uint24 rTokenTotal, uint24 rsrTotal) internal pure {
        require(rTokenTotal + rsrTotal >= MAX_DISTRIBUTION, "totals too low");
    }
}
