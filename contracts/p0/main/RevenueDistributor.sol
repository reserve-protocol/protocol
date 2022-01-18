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

    EnumerableSet.AddressSet internal _destinations;
    mapping(address => RevenueShare) internal _distribution;
    // invariant: distribution values are all nonnegative, and at least one is nonzero.

    address public constant FURNACE = address(1);
    address public constant ST_RSR = address(2);

    function init(ConstructorArgs calldata args) public virtual override(Mixin, SettingsHandlerP0) {
        super.init(args);
        _setDistribution(FURNACE, RevenueShare(args.dist.rTokenDist, FIX_ZERO));
        _setDistribution(ST_RSR, RevenueShare(FIX_ZERO, args.dist.rsrDist));
    }

    /// Set the RevenueShare for destination `dest`. Destinations `FURNACE` and `ST_RSR` refer to
    /// main.revenueFurnace() and main.stRSR().
    function setDistribution(address dest, RevenueShare memory share) public override onlyOwner {
        _setDistribution(dest, share);
    }

    /// Distribute revenue, in rsr or rtoken, per the _distribution table.
    /// Requires that this contract has an allowance of at least
    /// `amount` tokens, from `from`, of the token at `erc20`.
    function distribute(
        IERC20 erc20,
        address from,
        uint256 amount
    ) public override {
        require(erc20 == rsr() || erc20 == rToken(), "RSR or RToken");
        bool isRSR = erc20 == rsr(); // if false: isRToken
        (Fix rTokenTotal, Fix rsrTotal) = _totals();
        Fix total = isRSR ? rsrTotal : rTokenTotal;

        uint256 sliceSum;
        for (uint256 i = 0; i < _destinations.length(); i++) {
            address addrTo = _destinations.at(i);
            Fix subshare = isRSR ? _distribution[addrTo].rsrDist : _distribution[addrTo].rTokenDist;
            uint256 slice = subshare.mulu(amount).div(total).floor();
            if (slice == 0 || (!isRSR && addrTo == FURNACE) || (isRSR && addrTo == ST_RSR)) {
                continue;
            }
            sliceSum += slice;

            if (addrTo == FURNACE) {
                erc20.safeTransferFrom(from, address(revenueFurnace()), slice);
                revenueFurnace().notifyOfDeposit(erc20);
            } else if (addrTo == ST_RSR) {
                erc20.safeTransferFrom(from, address(stRSR()), slice);
                stRSR().notifyOfDeposit(erc20);
            } else {
                erc20.safeTransferFrom(from, addrTo, slice);
            }
        }

        uint256 delta = amount - sliceSum;
        if (delta > 0) {
            address sinkAddr = isRSR ? address(stRSR()) : address(revenueFurnace());
            erc20.safeTransferFrom(from, sinkAddr, delta);
            IERC20Receiver(sinkAddr).notifyOfDeposit(erc20);
        }
    }

    /// Returns the sum of all rsr cuts
    function rsrCut() public view returns (Fix) {
        (Fix rTokenTotal, Fix rsrTotal) = _totals();
        return rsrTotal.div(rsrTotal.plus(rTokenTotal));
    }

    /// Returns the sum of all rToken cuts
    function rTokenCut() public view returns (Fix) {
        return FIX_ONE.minus(rsrCut());
    }

    /// Returns the rsr + rToken totals
    function _totals() private view returns (Fix rTokenTotal, Fix rsrTotal) {
        for (uint256 i = 0; i < _destinations.length(); i++) {
            RevenueShare storage share = _distribution[_destinations.at(i)];
            rTokenTotal = rTokenTotal.plus(share.rTokenDist);
            rsrTotal = rsrTotal.plus(share.rsrDist);
        }
    }

    /// Sets the distribution values - Internals
    function _setDistribution(address dest, RevenueShare memory share) internal {
        _destinations.add(dest);
        _distribution[dest] = share;
    }
}
