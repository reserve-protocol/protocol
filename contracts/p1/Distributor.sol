// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "../interfaces/IDistributor.sol";
import "../interfaces/IMain.sol";
import "../libraries/Fixed.sol";
import "./mixins/Component.sol";

contract DistributorP1 is ComponentP1, IDistributor {
    using SafeERC20Upgradeable for IERC20Upgradeable;
    using FixLib for uint192;
    using EnumerableSet for EnumerableSet.AddressSet;

    EnumerableSet.AddressSet internal destinations;
    mapping(address => RevenueShare) public distribution;

    // ==== Invariants ====
    // distribution is nonzero. (That is, distribution has at least one nonzero value)
    //     (and thus this.totals() != {0, 0})
    // distribution[FURNACE].rsrDist == 0
    // distribution[ST_RSR].rTokenDist == 0
    // distribution has no more than MAX_DESTINATIONS_ALLOWED key-value entries
    // all distribution-share values are <= 10000

    // ==== destinations:
    // distribution[dest] != (0,0) if and only if dest in destinations

    address public constant FURNACE = address(1);
    address public constant ST_RSR = address(2);

    uint8 public constant MAX_DESTINATIONS_ALLOWED = 100;

    IERC20 private rsr;
    IERC20 private rToken;
    address private furnace;
    address private stRSR;

    function init(IMain main_, RevenueShare calldata dist) external initializer {
        __Component_init(main_);

        rsr = main_.rsr();
        rToken = IERC20(address(main_.rToken()));
        furnace = address(main_.furnace());
        stRSR = address(main_.stRSR());

        _ensureNonZeroDistribution(dist.rTokenDist, dist.rsrDist);
        _setDistribution(FURNACE, RevenueShare(dist.rTokenDist, 0));
        _setDistribution(ST_RSR, RevenueShare(0, dist.rsrDist));
    }

    /// Set the RevenueShare for destination `dest`. Destinations `FURNACE` and `ST_RSR` refer to
    /// main.furnace() and main.stRSR().
    /// @custom:governance
    // checks: invariants hold in post-state
    // effects:
    //   destinations' = destinations.add(dest)
    //   distribution' = distribution.set(dest, share)
    function setDistribution(address dest, RevenueShare memory share) external governance {
        _setDistribution(dest, share);
        RevenueTotals memory revTotals = totals();
        _ensureNonZeroDistribution(revTotals.rTokenTotal, revTotals.rsrTotal);
    }

    struct Transfer {
        IERC20 erc20;
        address addrTo;
        uint256 amount;
    }

    /// Distribute revenue, in rsr or rtoken, per the distribution table.
    /// Requires that this contract has an allowance of at least
    /// `amount` tokens, from `from`, of the token at `erc20`.
    /// @custom:interaction CEI
    // let:
    //   w = the map such that w[dest] = distribution[dest].{erc20}Shares
    //   tokensPerShare = floor(amount / sum(values(w)))
    //   addrOf(dest) = 1 -> furnace | 2 -> stRSR | x -> x
    // checks:
    //   erc20 is in {rsr, rToken}
    //   sum(values(w)) > 0
    // actions:
    //   for dest where w[dest] != 0:
    //     erc20.transferFrom(from, addrOf(dest), tokensPerShare * w[dest])
    function distribute(IERC20 erc20, uint256 amount) external notPausedOrFrozen {
        require(erc20 == rsr || erc20 == rToken, "RSR or RToken");
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

        Transfer[] memory transfers = new Transfer[](destinations.length());
        uint256 numTransfers;

        for (uint256 i = 0; i < destinations.length(); ++i) {
            address addrTo = destinations.at(i);

            uint256 numberOfShares = isRSR
                ? distribution[addrTo].rsrDist
                : distribution[addrTo].rTokenDist;
            if (numberOfShares == 0) continue;
            uint256 transferAmt = tokensPerShare * numberOfShares;

            if (addrTo == FURNACE) {
                addrTo = furnace;
            } else if (addrTo == ST_RSR) {
                addrTo = stRSR;
            }

            transfers[numTransfers] = Transfer({
                erc20: erc20,
                addrTo: addrTo,
                amount: transferAmt
            });
            numTransfers++;
        }
        emit RevenueDistributed(erc20, _msgSender(), amount);

        // == Interactions ==
        for (uint256 i = 0; i < numTransfers; i++) {
            Transfer memory t = transfers[i];
            IERC20Upgradeable(address(t.erc20)).safeTransferFrom(_msgSender(), t.addrTo, t.amount);
        }
    }

    /// The rsr and rToken shareTotals
    /// @return revTotals equals sum(distribution[d] for d in distribution)
    function totals() public view returns (RevenueTotals memory revTotals) {
        uint256 length = destinations.length();
        for (uint256 i = 0; i < length; ++i) {
            RevenueShare storage share = distribution[destinations.at(i)];
            revTotals.rTokenTotal += share.rTokenDist;
            revTotals.rsrTotal += share.rsrDist;
        }
    }

    // ==== Internal ====

    /// Set a distribution pair
    // checks:
    //   distribution'[FURNACE].rsrDist == 0
    //   distribution'[ST_RSR].rTokenDist == 0
    //   share.rsrDist <= 10000
    //   size(destinations') <= MAX_DESTINATIONS_ALLOWED
    // effects:
    //   destinations' = destinations.add(dest)
    //   distribution' = distribution.set(dest, share)
    function _setDistribution(address dest, RevenueShare memory share) internal {
        require(dest != address(0), "dest cannot be zero");
        require(
            dest != furnace && dest != stRSR,
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
    // checks: at least one of its arguments is nonzero
    function _ensureNonZeroDistribution(uint24 rTokenDist, uint24 rsrDist) internal pure {
        require(rTokenDist > 0 || rsrDist > 0, "no distribution defined");
    }

    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
     */
    uint256[46] private __gap;
}
