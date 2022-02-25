// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/main/SettingsHandler.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/BaseComponent.sol";

contract RevenueDistributorP0 is BaseComponent, SettingsHandlerP0, IRevenueDistributor {
    using SafeERC20 for IERC20;
    using FixLib for Fix;
    using EnumerableSet for EnumerableSet.AddressSet;

    EnumerableSet.AddressSet internal destinations;
    mapping(address => RevenueShare) internal distribution;
    // invariant: distribution values are all nonnegative, and at least one is nonzero.
    // invariant: distribution[FURNACE_ADDR].rsrDist == FIX_ZERO
    // invariant: distribution[ST_RSR_ADDR].rTokenDist == FIX_ZERO

    address public constant FURNACE_ADDR = address(1);
    address public constant ST_RSR_ADDR = address(2);

    function init(ConstructorArgs calldata args)
        public
        virtual
        override(BaseComponent, SettingsHandlerP0)
    {
        super.init(args);
        _setDistribution(FURNACE_ADDR, RevenueShare(args.dist.rTokenDist, 0));
        _setDistribution(ST_RSR_ADDR, RevenueShare(0, args.dist.rsrDist));
    }

    /// Set the RevenueShare for destination `dest`. Destinations `FURNACE_ADDR` and
    /// `ST_RSR_ADDR` refer to main.revenueFurnace() and main.stRSR().
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
        require(address(erc20) == addr(RSR) || address(erc20) == addr(RTOKEN), "RSR or RToken");
        bool isRSR = address(erc20) == addr(RSR); // if false: isRToken
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

            if (addrTo == FURNACE_ADDR) {
                erc20.safeTransferFrom(from, addr(REVENUE_FURNACE), transferAmt);
                IFurnace(addr(REVENUE_FURNACE)).notifyOfDeposit(erc20);
            } else if (addrTo == ST_RSR_ADDR) {
                erc20.safeTransferFrom(from, addr(ST_RSR), transferAmt);
                IStRSR(addr(RSR)).notifyOfDeposit(erc20);
            } else {
                erc20.safeTransferFrom(from, addrTo, transferAmt);
            }
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
        if (dest == FURNACE_ADDR) require(share.rsrDist == 0, "Furnace must get 0% of RSR");
        if (dest == ST_RSR_ADDR) require(share.rTokenDist == 0, "StRSR must get 0% of RToken");
        require(share.rsrDist <= 10000, "RSR distribution too high");
        require(share.rTokenDist <= 10000, "RSR distribution too high");

        destinations.add(dest);
        distribution[dest] = share;
        emit DistributionSet(dest, share.rTokenDist, share.rsrDist);
    }
}
