// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/main/Mixin.sol";
import "contracts/p0/main/SettingsHandler.sol";
import "contracts/libraries/Fixed.sol";

contract RevenueDistributorP0 is Mixin, SettingsHandlerP0, IRevenueDistributor {
    using SafeERC20 for IERC20;
    using FixLib for Fix;
    using EnumerableSet for EnumerableSet.AddressSet;

    EnumerableSet.AddressSet internal destinations;
    mapping(address => RevenueShare) internal distribution;
    // invariant: distribution values are all nonnegative, and at least one is nonzero.
    // invariant: distribution[FURNACE].rsrDist == FIX_ZERO
    // invariant: distribution[ST_RSR].rTokenDist == FIX_ZERO

    address public constant FURNACE = address(1);
    address public constant ST_RSR = address(2);

    function init(ConstructorArgs calldata args) public virtual override(Mixin, SettingsHandlerP0) {
        super.init(args);
        _setDistribution(FURNACE, RevenueShare(args.dist.rTokenDist, 0));
        _setDistribution(ST_RSR, RevenueShare(0, args.dist.rsrDist));
    }

    /// Set the RevenueShare for destination `dest`. Destinations `FURNACE` and `ST_RSR` refer to
    /// main.revenueFurnace() and main.stRSR().
    function setDistribution(address dest, RevenueShare memory share) public override onlyOwner {
        _setDistribution(dest, share);
    }

    /// Distribute revenue, in rsr or rtoken, per the distribution table.
    /// Requires that this contract has an allowance of at least
    /// `amount` tokens, from `from`, of the token at `erc20`.
    function distribute(
        IERC20 erc20,
        address from,
        uint256 amount
    ) public override {
        require(erc20 == rsr() || erc20 == rToken(), "RSR or RToken");
        bool isRSR = erc20 == rsr(); // if false: isRToken
        (uint256 rTokenTotal, uint256 rsrTotal) = shareTotals();
        uint256 totalShares = isRSR ? rsrTotal : rTokenTotal;

        // Evenly distribute revenue tokens per distribution share.
        uint256 tokensPerShare = amount / totalShares;

        for (uint256 i = 0; i < destinations.length(); i++) {
            address addrTo = destinations.at(i);
            uint256 numberOfShares = isRSR
                ? distribution[addrTo].rsrDist
                : distribution[addrTo].rTokenDist;
            if (numberOfShares == 0) continue;

            uint256 transferAmt = tokensPerShare * numberOfShares;

            if (addrTo == FURNACE) {
                addrTo = address(revenueFurnace());
            } else if (addrTo == ST_RSR) {
                addrTo = address(stRSR());
            }
            erc20.safeTransferFrom(from, addrTo, transferAmt);
        }
    }

    /// Returns the sum of all rsr cuts
    function rsrCut() public view returns (uint256 rsrShares, uint256 totalShares) {
        (uint256 rTokenTotal, uint256 rsrTotal) = shareTotals();
        return (rsrTotal, rsrTotal + rTokenTotal);
    }

    /// Returns the sum of all rToken cuts
    function rTokenCut() public view returns (uint256 rTokenShares, uint256 totalShares) {
        (uint256 rTokenTotal, uint256 rsrTotal) = shareTotals();
        return (rTokenTotal, rsrTotal + rTokenTotal);
    }

    /// Returns the rsr + rToken shareTotals
    function shareTotals() private view returns (uint256 rTokenTotal, uint256 rsrTotal) {
        for (uint256 i = 0; i < destinations.length(); i++) {
            RevenueShare storage share = distribution[destinations.at(i)];
            rTokenTotal += share.rTokenDist;
            rsrTotal += share.rsrDist;
        }
    }

    /// Sets the distribution values - Internals
    function _setDistribution(address dest, RevenueShare memory share) internal {
        if (dest == FURNACE) require(share.rsrDist == 0, "Furnace must get 0% of RSR");
        if (dest == ST_RSR) require(share.rTokenDist == 0, "StRSR must get 0% of RToken");
        require(share.rsrDist <= 10000, "RSR distribution too high");
        require(share.rTokenDist <= 10000, "RSR distribution too high");

        destinations.add(dest);
        distribution[dest] = share;
        emit DistributionSet(dest, share.rTokenDist, share.rsrDist);
    }
}
