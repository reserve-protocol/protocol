// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

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
    // all distribution-share values are <= MAX_DISTRIBUTION
    // totals().rTokenTotal + totals().rsrTotal >= MAX_DISTRIBUTION

    // ==== destinations:
    // distribution[dest] != (0,0) if and only if dest in destinations

    address public constant FURNACE = address(1);
    address public constant ST_RSR = address(2);

    uint8 public constant MAX_DESTINATIONS_ALLOWED = MAX_DESTINATIONS; // 100

    IERC20 private rsr;
    IERC20 private rToken;
    IFurnace private furnace;
    IStRSR private stRSR;
    address private rTokenTrader;
    address private rsrTrader;

    function init(IMain main_, RevenueShare calldata dist) external initializer {
        __Component_init(main_);
        cacheComponents();

        _ensureSufficientTotal(dist.rTokenDist, dist.rsrDist);
        _setDistribution(FURNACE, RevenueShare(dist.rTokenDist, 0));
        _setDistribution(ST_RSR, RevenueShare(0, dist.rsrDist));
    }

    /// Set the RevenueShare for destination `dest`. Destinations `FURNACE` and `ST_RSR` refer to
    /// main.furnace() and main.stRSR().
    /// Consider calling `BackingManager.forwardRevenue()` before to ensure fair past distribution
    /// @custom:governance
    // checks: invariants hold in post-state
    // effects:
    //   destinations' = destinations.add(dest)
    //   distribution' = distribution.set(dest, share)
    function setDistribution(address dest, RevenueShare calldata share) external governance {
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
    /// Consider calling `BackingManager.forwardRevenue()` before to ensure fair past distribution
    /// @custom:governance
    // checks: invariants hold in post-state
    // effects:
    //   destinations' = destinations.add(dests[i]) for i < dests.length
    //   distribution' = distribution.set(dests[i], shares[i]) for i < dests.length
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

    struct Transfer {
        address addrTo;
        uint256 amount;
    }

    /// Distribute revenue, in rsr or rtoken, per the distribution table.
    /// Requires that this contract has an allowance of at least
    /// `amount` tokens, from `from`, of the token at `erc20`.
    /// Only callable by RevenueTraders
    /// @custom:protected CEI
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
    function distribute(IERC20 erc20, uint256 amount) external {
        // Intentionally do not check notTradingPausedOrFrozen, since handled by caller

        address caller = _msgSender();
        require(caller == rsrTrader || caller == rTokenTrader, "RevenueTraders only");
        require(erc20 == rsr || erc20 == rToken, "RSR or RToken");
        bool isRSR = erc20 == rsr; // if false: isRToken

        uint256 tokensPerShare;
        uint256 totalShares;
        {
            RevenueTotals memory revTotals = totals();
            totalShares = isRSR ? revTotals.rsrTotal : revTotals.rTokenTotal;
            if (totalShares != 0) tokensPerShare = amount / totalShares;
            require(tokensPerShare != 0, "nothing to distribute");
        }
        // Evenly distribute revenue tokens per distribution share.
        // This rounds "early", and that's deliberate!

        Transfer[] memory transfers = new Transfer[](destinations.length());
        uint256 numTransfers;

        bool accountRewards = false;
        uint256 paidOutShares;

        for (uint256 i = 0; i < destinations.length(); ++i) {
            address addrTo = destinations.at(i);

            uint256 numberOfShares = isRSR
                ? distribution[addrTo].rsrDist
                : distribution[addrTo].rTokenDist;
            if (numberOfShares == 0) continue;
            uint256 transferAmt = tokensPerShare * numberOfShares;
            paidOutShares += numberOfShares;

            if (addrTo == FURNACE) {
                addrTo = address(furnace);
                if (transferAmt != 0) accountRewards = true;
            } else if (addrTo == ST_RSR) {
                addrTo = address(stRSR);
                if (transferAmt != 0) accountRewards = true;
            }

            transfers[numTransfers] = Transfer({ addrTo: addrTo, amount: transferAmt });
            ++numTransfers;
        }
        emit RevenueDistributed(erc20, caller, amount);

        // == Interactions ==
        for (uint256 i = 0; i < numTransfers; ++i) {
            IERC20Upgradeable(address(erc20)).safeTransferFrom(
                caller,
                transfers[i].addrTo,
                transfers[i].amount
            );
        }

        DAOFeeRegistry daoFeeRegistry = main.daoFeeRegistry();
        if (address(daoFeeRegistry) != address(0)) {
            if (totalShares > paidOutShares) {
                (address recipient, , ) = main.daoFeeRegistry().getFeeDetails(address(rToken));

                if (recipient != address(0)) {
                    IERC20Upgradeable(address(erc20)).safeTransferFrom(
                        caller,
                        recipient,
                        tokensPerShare * (totalShares - paidOutShares)
                    );
                }
            }
        }

        // Perform reward accounting
        if (accountRewards) {
            if (isRSR) {
                stRSR.payoutRewards();
            } else {
                furnace.melt();
            }
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

        DAOFeeRegistry daoFeeRegistry = main.daoFeeRegistry();
        if (address(daoFeeRegistry) != address(0)) {
            // DAO Fee
            (address feeRecipient, uint256 feeNumerator, uint256 feeDenominator) = main
            .daoFeeRegistry()
            .getFeeDetails(address(rToken));

            // Small DAO fees <1% not recommended; ~10% precision due to rounding at 0.1% fee
            if (feeRecipient != address(0) && feeNumerator != 0) {
                revTotals.rsrTotal += uint24(
                    (feeNumerator * uint256(revTotals.rTokenTotal + revTotals.rsrTotal)) /
                        (feeDenominator - feeNumerator)
                );
            }
        }
    }

    // ==== Internal ====

    /// Set a distribution pair
    // checks:
    //   distribution'[FURNACE].rsrDist == 0
    //   distribution'[ST_RSR].rTokenDist == 0
    //   share.rsrDist <= MAX_DISTRIBUTION
    //   size(destinations') <= MAX_DESTINATIONS_ALLOWED
    // effects:
    //   destinations' = destinations.add(dest)
    //   distribution' = distribution.set(dest, share)
    function _setDistribution(address dest, RevenueShare memory share) internal {
        require(dest != address(0), "dest cannot be zero");
        require(
            dest != address(furnace) && dest != address(stRSR),
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
    // checks: sum exceeds MAX_DISTRIBUTION
    function _ensureSufficientTotal(uint24 rTokenTotal, uint24 rsrTotal) internal pure {
        require(uint256(rTokenTotal) + uint256(rsrTotal) >= MAX_DISTRIBUTION, "totals too low");
    }

    /// Call after upgrade to >= 3.0.0
    function cacheComponents() public {
        rsr = main.rsr();
        rToken = IERC20(address(main.rToken()));
        furnace = main.furnace();
        stRSR = main.stRSR();
        rTokenTrader = address(main.rTokenTrader());
        rsrTrader = address(main.rsrTrader());
    }

    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
     *
     * Distributor uses 53 slots, not 50.
     */
    uint256[44] private __gap;
}
