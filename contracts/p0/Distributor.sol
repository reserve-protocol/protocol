// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

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

    uint8 public constant MAX_DESTINATIONS_ALLOWED = 100;

    function init(IMain main_, RevenueShare memory dist) public initializer {
        __Component_init(main_);
        _ensureNonZeroDistribution(dist.rTokenDist, dist.rsrDist);
        _setDistribution(FURNACE, RevenueShare(dist.rTokenDist, 0));
        _setDistribution(ST_RSR, RevenueShare(0, dist.rsrDist));
    }

    /// Set the RevenueShare for destination `dest`. Destinations `FURNACE` and `ST_RSR` refer to
    /// main.furnace() and main.stRSR().
    function setDistribution(address dest, RevenueShare memory share) external governance {
        _setDistribution(dest, share);
        RevenueTotals memory revTotals = totals();
        _ensureNonZeroDistribution(revTotals.rTokenTotal, revTotals.rsrTotal);
    }

    /// Distribute revenue, in rsr or rtoken, per the distribution table.
    /// Requires that this contract has an allowance of at least
    /// `amount` tokens, from `from`, of the token at `erc20`.
    function distribute(IERC20 erc20, uint256 amount) external notPausedOrFrozen {
        IERC20 rsr = main.rsr();

        require(erc20 == rsr || erc20 == IERC20(address(main.rToken())), "RSR or RToken");
        bool isRSR = erc20 == rsr; // if false: isRToken
        uint256 tokensPerShare;
        {
            RevenueTotals memory revTotals = totals();
            uint256 totalShares = isRSR ? revTotals.rsrTotal : revTotals.rTokenTotal;
            require(totalShares > 0, "nothing to distribute");
            tokensPerShare = amount / totalShares;
        }

        // Evenly distribute revenue tokens per distribution share.
        // This rounds "early", and that's deliberate!

        for (uint256 i = 0; i < destinations.length(); i++) {
            address addrTo = destinations.at(i);

            uint256 numberOfShares = isRSR
                ? distribution[addrTo].rsrDist
                : distribution[addrTo].rTokenDist;
            if (numberOfShares == 0) continue;
            uint256 transferAmt = tokensPerShare * numberOfShares;

            if (addrTo == FURNACE) {
                addrTo = address(main.furnace());
            } else if (addrTo == ST_RSR) {
                addrTo = address(main.stRSR());
            }
            erc20.safeTransferFrom(_msgSender(), addrTo, transferAmt);
        }
        emit RevenueDistributed(erc20, _msgSender(), amount);
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
        if (dest == FURNACE) require(share.rsrDist == 0, "Furnace must get 0% of RSR");
        if (dest == ST_RSR) require(share.rTokenDist == 0, "StRSR must get 0% of RToken");
        require(share.rsrDist <= 10000, "RSR distribution too high");
        require(share.rTokenDist <= 10000, "RToken distribution too high");

        if (share.rsrDist == 0 && share.rTokenDist == 0) {
            destinations.remove(dest);
        } else {
            destinations.add(dest);
            require(destinations.length() <= MAX_DESTINATIONS_ALLOWED, "Too many destinations");
        }

        distribution[dest] = share;
        emit DistributionSet(dest, share.rTokenDist, share.rsrDist);
    }

    /// Ensures distribution values are non-zero
    function _ensureNonZeroDistribution(uint24 rTokenDist, uint24 rsrDist) internal pure {
        require(rTokenDist > 0 || rsrDist > 0, "no distribution defined");
    }
}
