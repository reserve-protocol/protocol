// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "contracts/interfaces/IMain.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/p1/mixins/Component.sol";

contract DistributorP1 is ComponentP1, IDistributor {
    using SafeERC20Upgradeable for IERC20Upgradeable;
    using FixLib for int192;
    using EnumerableSet for EnumerableSet.AddressSet;

    EnumerableSet.AddressSet internal destinations;
    mapping(address => RevenueShare) internal distribution;
    // invariant: distribution values are all nonnegative, and at least one is nonzero.
    // invariant: distribution[FURNACE].rsrDist == FIX_ZERO
    // invariant: distribution[ST_RSR].rTokenDist == FIX_ZERO

    address public constant FURNACE = address(1);
    address public constant ST_RSR = address(2);

    function init(IMain main_, RevenueShare calldata dist) external initializer {
        __Component_init(main_);
        _setDistribution(FURNACE, RevenueShare(dist.rTokenDist, 0));
        _setDistribution(ST_RSR, RevenueShare(0, dist.rsrDist));
    }

    /// Set the RevenueShare for destination `dest`. Destinations `FURNACE` and `ST_RSR` refer to
    /// main.furnace() and main.stRSR().
    function setDistribution(address dest, RevenueShare memory share) external onlyOwner {
        _setDistribution(dest, share);
    }

    /// Distribute revenue, in rsr or rtoken, per the distribution table.
    /// Requires that this contract has an allowance of at least
    /// `amount` tokens, from `from`, of the token at `erc20`.
    function distribute(
        IERC20 erc20,
        address from,
        uint256 amount
    ) external {
        // nonReentrant not required: external calls occur last
        IERC20 rsr = main.rsr();

        require(erc20 == rsr || erc20 == IERC20(address(main.rToken())), "RSR or RToken");
        bool isRSR = erc20 == rsr; // if false: isRToken
        uint256 tokensPerShare;
        {
            RevenueTotals memory revTotals = totals();
            uint256 totalShares = isRSR ? revTotals.rsrTotal : revTotals.rTokenTotal;
            tokensPerShare = amount / totalShares;
        }

        // Evenly distribute revenue tokens per distribution share.
        // This rounds "early", and that's deliberate!
        address furnace = address(main.furnace());
        address stRSR = address(main.stRSR());
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
            IERC20Upgradeable(address(erc20)).safeTransferFrom(from, addrTo, transferAmt);
        }
    }

    /// Returns the rsr + rToken shareTotals
    function totals() public view returns (RevenueTotals memory revTotals) {
        uint256 length = destinations.length();
        for (uint256 i = 0; i < length; ++i) {
            RevenueShare storage share = distribution[destinations.at(i)];
            revTotals.rTokenTotal += share.rTokenDist;
            revTotals.rsrTotal += share.rsrDist;
        }
    }

    /// Sets the distribution values - Internals
    function _setDistribution(address dest, RevenueShare memory share) internal {
        if (dest == FURNACE) require(share.rsrDist == 0, "Furnace must get 0% of RSR");
        if (dest == ST_RSR) require(share.rTokenDist == 0, "StRSR must get 0% of RToken");
        require(share.rsrDist <= 10000, "RSR distribution too high");
        require(share.rTokenDist <= 10000, "RToken distribution too high");

        destinations.add(dest);
        distribution[dest] = share;
        emit DistributionSet(dest, share.rTokenDist, share.rsrDist);
    }
}
